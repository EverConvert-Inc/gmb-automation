import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CALLRAIL_TRACKER_CALL_FIELDS,
  LEAD_STATUS_TAGS,
  inferTagFilterSemantics,
  probeTagFilterSemantics,
  CALLRAIL_TRACKER_FORM_FIELDS,
  fetchCallsForCompany,
  fetchFormSubmissionsForCompany,
  fetchWithRetry,
  listTrackerCompanyIds,
  mapWithConcurrency,
  resetTrackerAccountIdCache,
  tagNames,
} from "./callrail-client";

function res(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const NO_WAIT = { sleep: async () => {}, baseDelayMs: 1 };

beforeEach(() => {
  process.env.CALLRAIL_API_KEY = "test-key";
  process.env.CALLRAIL_ACCOUNT_ID = "AC1";
  resetTrackerAccountIdCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CALLRAIL_ACCOUNT_ID;
});

describe("field lists", () => {
  // Pinned. CallRail 400s the WHOLE request on one unknown field name, so a
  // silent edit here breaks every fetch rather than dropping one column.
  it("calls", () => {
    expect([...CALLRAIL_TRACKER_CALL_FIELDS]).toEqual([
      "id",
      "company_name",
      "customer_name",
      "customer_phone_number",
      "source_name",
      "formatted_tracking_source",
      "tracker_id",
      "start_time",
      "tags",
      "note",
    ]);
  });

  it("forms", () => {
    expect([...CALLRAIL_TRACKER_FORM_FIELDS]).toEqual([
      "note",
      "tags",
      "customer_name",
      "customer_phone_number",
      "form_data",
      "source",
      "referrer",
      "submitted_at",
      "company_name",
    ]);
  });
});

describe("fetchWithRetry — the 429 path", () => {
  it("retries a 429 and returns the eventual success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(429, {}))
      .mockResolvedValueOnce(res(429, {}))
      .mockResolvedValueOnce(res(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const r = await fetchWithRetry("https://x/y", {}, NO_WAIT);
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("honours Retry-After in seconds instead of its own backoff", async () => {
    const slept: number[] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(429, {}, { "retry-after": "7" }))
      .mockResolvedValueOnce(res(200, {}));
    vi.stubGlobal("fetch", fetchMock);

    await fetchWithRetry("https://x/y", {}, {
      sleep: async (ms) => { slept.push(ms); },
      baseDelayMs: 1,
    });
    expect(slept).toEqual([7000]);
  });

  it("gives up after maxAttempts and returns the last 429", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(429, {}));
    vi.stubGlobal("fetch", fetchMock);

    const r = await fetchWithRetry("https://x/y", {}, { ...NO_WAIT, maxAttempts: 3 });
    expect(r.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries a 500 — same transient class", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(502, {}))
      .mockResolvedValueOnce(res(200, {}));
    vi.stubGlobal("fetch", fetchMock);

    expect((await fetchWithRetry("https://x/y", {}, NO_WAIT)).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // A bad field name fails identically forever — retrying only multiplies
  // the damage against a shared API key.
  it.each([400, 401, 403, 404])("does NOT retry a %s", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(res(status, {}));
    vi.stubGlobal("fetch", fetchMock);

    const r = await fetchWithRetry("https://x/y", {}, NO_WAIT);
    expect(r.status).toBe(status);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a persistent 429 as a thrown error from a real fetch call", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(429, {})));
    await expect(
      fetchCallsForCompany("COM1", "2026-10-01", "2026-10-14", {
        ...NO_WAIT,
        maxAttempts: 2,
      }),
    ).rejects.toThrow(/429/);
  });
});

describe("mapWithConcurrency", () => {
  it("never exceeds the cap and preserves input order", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return n * 2;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
  });

  it("handles an empty list", async () => {
    expect(await mapWithConcurrency([], 3, async () => 1)).toEqual([]);
  });
});

describe("pagination and query parameters", () => {
  it("pages through calls until total_pages is reached", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(200, { calls: [{ id: "1" }, { id: "2" }], total_pages: 2 }))
      .mockResolvedValueOnce(res(200, { calls: [{ id: "3" }], total_pages: 2 }));
    vi.stubGlobal("fetch", fetchMock);

    const calls = await fetchCallsForCompany("COM1", "2026-10-01", "2026-10-14", NO_WAIT);
    expect(calls.map((c) => c.id)).toEqual(["1", "2", "3"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("page=2");
  });

  it("sends the pinned call fields, the company and the Eastern date bounds", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200, { calls: [], total_pages: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchCallsForCompany("COM9", "2026-10-01", "2026-10-14", NO_WAIT);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/v3/a/AC1/calls.json");
    expect(url.searchParams.get("company_id")).toBe("COM9");
    expect(url.searchParams.get("start_date")).toBe("2026-10-01");
    expect(url.searchParams.get("end_date")).toBe("2026-10-14");
    expect(url.searchParams.get("per_page")).toBe("250");
    expect(url.searchParams.get("fields")).toBe(
      CALLRAIL_TRACKER_CALL_FIELDS.join(","),
    );
  });

  it("sends the pinned form fields to form_submissions.json", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(res(200, { form_submissions: [{ id: "f1" }], total_pages: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    const forms = await fetchFormSubmissionsForCompany(
      "COM9",
      "2026-10-01",
      "2026-10-14",
      NO_WAIT,
    );
    expect(forms.map((f) => f.id)).toEqual(["f1"]);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/v3/a/AC1/form_submissions.json");
    expect(url.searchParams.get("fields")).toBe(
      CALLRAIL_TRACKER_FORM_FIELDS.join(","),
    );
  });

  it("sends the agency API key as a Token header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200, { calls: [], total_pages: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchCallsForCompany("COM1", "2026-10-01", "2026-10-14", NO_WAIT);
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Token token="test-key"');
  });

  it("throws with the status and body when CallRail rejects the request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(res(400, { error: "unknown field: nope" })),
    );
    await expect(
      fetchCallsForCompany("COM1", "2026-10-01", "2026-10-14", NO_WAIT),
    ).rejects.toThrow(/400.*unknown field/s);
  });
});

describe("listTrackerCompanyIds", () => {
  it("pages and skips disabled companies", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        res(200, {
          companies: [
            { id: "C1", status: "active" },
            { id: "C2", status: "disabled" },
          ],
          total_pages: 2,
        }),
      )
      .mockResolvedValueOnce(res(200, { companies: [{ id: "C3" }], total_pages: 2 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await listTrackerCompanyIds(NO_WAIT)).toEqual(["C1", "C3"]);
  });
});

describe("tagNames", () => {
  it.each([
    [["Signed", "Opportunity"], ["Signed", "Opportunity"]],
    [[{ name: "Signed" }, { name: "Lost" }], ["Signed", "Lost"]],
    [[{ name: "Signed" }, "Lost"], ["Signed", "Lost"]],
    [[{ name: null }, { name: "  " }, "Signed"], ["Signed"]],
    [null, []],
    [undefined, []],
  ])("%s -> %s", (input, expected) => {
    expect(tagNames(input as never)).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// Server-side tag filter
// ---------------------------------------------------------------------------

function tagsIn(url: unknown): string[] {
  return new URL(String(url)).searchParams.getAll("tags[]");
}

describe("LEAD_STATUS_TAGS", () => {
  // Pinned. These decide what is a lead at all — a record carrying none of
  // them is never fetched, so an accidental edit silently stops ingestion.
  it("is Opportunity plus the full status ladder, in that order", () => {
    expect([...LEAD_STATUS_TAGS]).toEqual([
      "Opportunity",
      "Signed",
      "Pending",
      "Lost",
      "Rejected",
      "No Case",
      "Referred out",
      "No Contact",
      "Declined",
    ]);
  });

  it("excludes the tags the first dry run showed are not leads", () => {
    for (const notALead of ["Client", "Admin", "Duplicate"]) {
      expect(LEAD_STATUS_TAGS).not.toContain(notALead);
    }
  });
});

describe("the fetch is tag-filtered server-side", () => {
  it("sends one tags[] param per status tag on calls, by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200, { calls: [], total_pages: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchCallsForCompany("COM1", "2026-10-01", "2026-10-14", NO_WAIT);
    expect(tagsIn(fetchMock.mock.calls[0][0])).toEqual([...LEAD_STATUS_TAGS]);
  });

  it("sends the same filter on form submissions", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(res(200, { form_submissions: [], total_pages: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchFormSubmissionsForCompany("COM1", "2026-10-01", "2026-10-14", NO_WAIT);
    expect(tagsIn(fetchMock.mock.calls[0][0])).toEqual([...LEAD_STATUS_TAGS]);
  });

  // The previous-month pass calls this same function with a different
  // window, so filtering by default is what makes both passes filtered.
  it("filters EVERY window, not just the current month", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200, { calls: [], total_pages: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchCallsForCompany("COM1", "2026-10-01", "2026-10-14", NO_WAIT);
    await fetchCallsForCompany("COM1", "2026-09-01", "2026-09-30", NO_WAIT);
    for (const call of fetchMock.mock.calls) {
      expect(tagsIn(call[0])).toEqual([...LEAD_STATUS_TAGS]);
    }
  });

  it("filters every PAGE, not just the first", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(200, { calls: [{ id: "1" }], total_pages: 3 }))
      .mockResolvedValueOnce(res(200, { calls: [{ id: "2" }], total_pages: 3 }))
      .mockResolvedValueOnce(res(200, { calls: [{ id: "3" }], total_pages: 3 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchCallsForCompany("COM1", "2026-10-01", "2026-10-14", NO_WAIT);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      expect(tagsIn(call[0])).toEqual([...LEAD_STATUS_TAGS]);
    }
  });

  it("sends NO tags[] when explicitly told not to filter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200, { calls: [], total_pages: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchCallsForCompany("COM1", "2026-10-01", "2026-10-14", {
      ...NO_WAIT,
      tags: null,
    });
    expect(tagsIn(fetchMock.mock.calls[0][0])).toEqual([]);
  });

  it("honours an explicit tag list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200, { calls: [], total_pages: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchCallsForCompany("COM1", "2026-10-01", "2026-10-14", {
      ...NO_WAIT,
      tags: ["Signed"],
    });
    expect(tagsIn(fetchMock.mock.calls[0][0])).toEqual(["Signed"]);
  });

  it("leaves the other query parameters untouched", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200, { calls: [], total_pages: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchCallsForCompany("COM1", "2026-10-01", "2026-10-14", NO_WAIT);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("company_id")).toBe("COM1");
    expect(url.searchParams.get("start_date")).toBe("2026-10-01");
    expect(url.searchParams.get("fields")).toBe(CALLRAIL_TRACKER_CALL_FIELDS.join(","));
  });
});

describe("inferTagFilterSemantics", () => {
  it.each([
    ["OR: all-tags sits between a single tag and unfiltered", 790, 12, 25, "or"],
    ["AND: all-tags is below a single tag", 790, 12, 0, "and"],
    ["AND: strictly fewer", 790, 12, 3, "and"],
    ["IGNORED: all-tags equals unfiltered while one tag is fewer", 790, 12, 790, "ignored"],
    ["equal counts with a tag present is still OR", 790, 25, 25, "or"],
  ])("%s", (_label, unfiltered, single, all, expected) => {
    expect(
      inferTagFilterSemantics(
        unfiltered as number,
        single as number,
        all as number,
      ).semantics,
    ).toBe(expected);
  });

  it("is inconclusive when nothing in the window carries a tag", () => {
    const r = inferTagFilterSemantics(790, 0, 0);
    expect(r.semantics).toBe("inconclusive");
    expect(r.explanation).toMatch(/does not|no record/i);
  });

  it.each([
    [null, 1, 1],
    [1, null, 1],
    [1, 1, null],
  ])("is inconclusive when total_records is missing (%s,%s,%s)", (u, s2, a) => {
    expect(
      inferTagFilterSemantics(u as number | null, s2 as number | null, a as number | null)
        .semantics,
    ).toBe("inconclusive");
  });
});

describe("probeTagFilterSemantics", () => {
  it("makes three one-record counts and reports OR", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const n = tagsIn(url).length;
      const total = n === 0 ? 790 : n === 1 ? 12 : 25;
      return Promise.resolve(res(200, { calls: [], total_records: total, total_pages: 1 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const probe = await probeTagFilterSemantics(
      "calls",
      "COM1",
      "2026-10-01",
      "2026-10-14",
      NO_WAIT,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(probe).toMatchObject({
      path: "calls.json",
      unfiltered: 790,
      singleTag: 12,
      singleTagName: "Opportunity",
      allTags: 25,
      semantics: "or",
    });
    // One record per probe request, never a full page of PII.
    for (const call of fetchMock.mock.calls) {
      expect(new URL(String(call[0])).searchParams.get("per_page")).toBe("1");
    }
  });

  it("detects AND semantics", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const n = tagsIn(url).length;
      const total = n === 0 ? 790 : n === 1 ? 12 : 0;
      return Promise.resolve(res(200, { calls: [], total_records: total, total_pages: 1 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const probe = await probeTagFilterSemantics(
      "calls",
      "COM1",
      "2026-10-01",
      "2026-10-14",
      NO_WAIT,
    );
    expect(probe.semantics).toBe("and");
    expect(probe.explanation).toMatch(/one request per tag/i);
  });

  it("probes form_submissions when asked", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(res(200, { form_submissions: [], total_records: 3, total_pages: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    const probe = await probeTagFilterSemantics(
      "forms",
      "COM1",
      "2026-10-01",
      "2026-10-14",
      NO_WAIT,
    );
    expect(probe.path).toBe("form_submissions.json");
    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe(
      "/v3/a/AC1/form_submissions.json",
    );
  });

  it("is inconclusive when CallRail omits total_records", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(res(200, { calls: [], total_pages: 1 })),
    );
    const probe = await probeTagFilterSemantics(
      "calls",
      "COM1",
      "2026-10-01",
      "2026-10-14",
      NO_WAIT,
    );
    expect(probe.semantics).toBe("inconclusive");
    expect(probe.unfiltered).toBeNull();
  });
});
