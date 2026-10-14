import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CALLRAIL_TRACKER_CALL_FIELDS,
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
