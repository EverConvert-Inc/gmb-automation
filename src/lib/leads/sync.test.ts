import { afterEach, describe, expect, it, vi } from "vitest";
import {
  maskName,
  maskPhone,
  normalizeCall,
  normalizeForm,
  parseCallrailInstant,
  planLeadWrites,
  redactNoteStructure,
  resolveSyncWindow,
  NOTE_STRUCTURE_SAMPLE_CAP,
  stringifyError,
  syncLeadsForMonth,
  type SyncDeps,
} from "./sync";
import { buildRoutingIndex } from "./routing";
import { leadKey, type LeadSource, type LeadStore, type PlannedLead } from "./types";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

type StoredRow = PlannedLead & {
  signedAtSource: string | null;
  firstSeenAt: Date;
  lastSyncedAt: Date;
};

/**
 * Mirrors the real store's conflict semantics — keyed on the same unique
 * columns, and signed_at applied with coalesce(existing, new) so "the
 * webhook's receipt time wins" is actually exercised rather than assumed.
 */
function makeFakeStore(
  opts: {
    tagRules?: { firmId: string; tagName: string }[];
    companyRules?: { firmId: string; callrailCompanyId: string }[];
    pending?: Partial<Record<LeadSource, string[]>>;
    seed?: StoredRow[];
  } = {},
) {
  const rows = new Map<string, StoredRow>();
  for (const r of opts.seed ?? []) {
    rows.set(`${r.firmId ?? "null"}|${r.callrailId}|${r.personSuffix}`, r);
  }
  const jobs: {
    kind: string;
    status: string;
    triggeredBy: string;
    errorMessage: string | null;
    leadsIngested: number;
  }[] = [];
  const counts = { pendingLookups: 0, upserts: 0 };

  const store: LeadStore = {
    async loadRoutingRules() {
      return {
        tagRules: opts.tagRules ?? [],
        companyRules: opts.companyRules ?? [],
      };
    },
    async findPendingCallrailIds(_from, _to, source) {
      counts.pendingLookups += 1;
      return new Set(opts.pending?.[source] ?? []);
    },
    async findAssignedFirmIds(ids) {
      const map = new Map<string, string[]>();
      for (const r of rows.values()) {
        if (r.firmId === null || !ids.includes(r.callrailId)) continue;
        const k = leadKey(r.callrailId, r.personSuffix);
        const list = map.get(k) ?? [];
        if (!list.includes(r.firmId)) list.push(r.firmId);
        map.set(k, list);
      }
      return map;
    },
    async upsertLeads(incoming) {
      counts.upserts += 1;
      const now = new Date();
      for (const r of incoming) {
        const key = `${r.firmId ?? "null"}|${r.callrailId}|${r.personSuffix}`;
        const existing = rows.get(key);
        if (!existing) {
          rows.set(key, {
            ...r,
            signedAtSource: r.signedAt ? "sync" : null,
            firstSeenAt: now,
            lastSyncedAt: now,
          });
          continue;
        }
        rows.set(key, {
          ...existing,
          ...r,
          signedAt: existing.signedAt ?? r.signedAt,
          signedAtSource: existing.signedAt
            ? existing.signedAtSource
            : r.signedAt
              ? "sync"
              : existing.signedAtSource,
          firstSeenAt: existing.firstSeenAt,
          lastSyncedAt: now,
        });
      }
      return { written: incoming.length };
    },
    async startJob(i) {
      jobs.push({
        kind: i.kind,
        status: "running",
        triggeredBy: i.triggeredBy,
        errorMessage: null,
        leadsIngested: 0,
      });
      return `job-${jobs.length}`;
    },
    async finishJob(i) {
      const idx = Number(i.jobId.split("-")[1]) - 1;
      jobs[idx] = {
        ...jobs[idx],
        status: i.status,
        errorMessage: i.errorMessage,
        leadsIngested: i.leadsIngested,
      };
    },
  };

  return { store, rows, jobs, counts };
}

function makeDeps(store: LeadStore, over: Partial<SyncDeps> = {}): SyncDeps {
  return {
    listCompanyIds: async () => ["COM1"],
    fetchCalls: async () => [],
    fetchForms: async () => [],
    store,
    now: () => new Date(),
    ...over,
  };
}

const CALL = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  start_time: "2026-10-05T14:30:00.000-04:00",
  customer_name: "Fallback Name",
  customer_phone_number: "555-000-1111",
  source_name: "PPC - Main",
  tracker_id: "TRK1",
  tags: ["Signed"],
  note: "Jane Doe, 555-123-4567",
  ...over,
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Window — Eastern month boundaries
// ---------------------------------------------------------------------------

describe("resolveSyncWindow", () => {
  it("uses the EASTERN month while UTC has already rolled over", () => {
    // 2026-08-01T02:30:00Z = 2026-07-31 22:30 ET. Still July in Eastern.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T02:30:00Z"));
    expect(resolveSyncWindow()).toEqual({
      currentFrom: "2026-07-01",
      currentTo: "2026-07-31",
      previousFrom: "2026-06-01",
      previousTo: "2026-06-30",
    });
  });

  it("rolls into the new month once Eastern midnight has passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00Z")); // 08:00 ET, Aug 1
    expect(resolveSyncWindow()).toEqual({
      currentFrom: "2026-08-01",
      currentTo: "2026-08-01",
      previousFrom: "2026-07-01",
      previousTo: "2026-07-31",
    });
  });

  it("crosses a year boundary on the previous-month window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T15:00:00Z"));
    const w = resolveSyncWindow();
    expect(w.currentFrom).toBe("2026-01-01");
    expect(w.previousFrom).toBe("2025-12-01");
    expect(w.previousTo).toBe("2025-12-31");
  });

  it("handles a short February", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T15:00:00Z"));
    expect(resolveSyncWindow().previousTo).toBe("2026-02-28");
  });
});

describe("parseCallrailInstant", () => {
  it("reads an offset timestamp as the instant it names", () => {
    expect(parseCallrailInstant("2026-10-05T14:30:00.000-04:00")?.toISOString()).toBe(
      "2026-10-05T18:30:00.000Z",
    );
  });

  it("reads a Z timestamp as UTC", () => {
    expect(parseCallrailInstant("2026-10-05T18:30:00Z")?.toISOString()).toBe(
      "2026-10-05T18:30:00.000Z",
    );
  });

  // Would land 4 hours early if it were treated as UTC.
  it("reads a bare wall clock as EASTERN, not UTC", () => {
    expect(parseCallrailInstant("2026-10-05 14:30:00")?.toISOString()).toBe(
      "2026-10-05T18:30:00.000Z",
    );
  });

  it.each([[null], [undefined], [""], ["   "], ["nonsense"]])(
    "%s is null",
    (v) => {
      expect(parseCallrailInstant(v as string | null)).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

describe("normalizeCall / normalizeForm", () => {
  it("maps a call onto the planner's shape", () => {
    const lead = normalizeCall(CALL() as never, "COM1");
    expect(lead).toMatchObject({
      source: "call",
      callrailId: "c1",
      callrailCompanyId: "COM1",
      tags: ["Signed"],
      note: "Jane Doe, 555-123-4567",
      customerName: "Fallback Name",
      customerPhoneNumber: "555-000-1111",
      rawSourceName: "PPC - Main",
      rawTrackerId: "TRK1",
      rawFormData: null,
    });
  });

  it("falls back to formatted_tracking_source for the channel", () => {
    const lead = normalizeCall(
      CALL({ source_name: null, formatted_tracking_source: "Fallback Source" }) as never,
      "COM1",
    );
    expect(lead?.rawSourceName).toBe("Fallback Source");
  });

  it.each([[{ id: "" }], [{ start_time: null }], [{ start_time: "bad" }]])(
    "drops an unusable call record (%s)",
    (over) => {
      expect(normalizeCall(CALL(over) as never, "COM1")).toBeNull();
    },
  );

  it("maps a form, keeping form_data for the admin queue", () => {
    const lead = normalizeForm(
      {
        id: "f1",
        submitted_at: "2026-10-06T10:00:00.000-04:00",
        note: "John Roe, 555-222-3333",
        tags: [{ name: "Opportunity" }],
        customer_name: "Form Name",
        customer_phone_number: "555-999-0000",
        form_data: { full_name: "John Roe", phone_number: "555-222-3333" },
        source: "Google Organic",
      } as never,
      "COM2",
    );
    expect(lead).toMatchObject({
      source: "form",
      callrailId: "f1",
      tags: ["Opportunity"],
      rawSourceName: "Google Organic",
      rawFormData: { full_name: "John Roe", phone_number: "555-222-3333" },
    });
  });
});

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

const NOW = new Date("2026-10-14T15:00:00Z");
const leadOf = (over: Record<string, unknown> = {}) =>
  normalizeCall(CALL(over) as never, "COM1")!;

describe("planLeadWrites — routing", () => {
  it("routes by firm tag and copies to every matching firm", () => {
    const index = buildRoutingIndex(
      [
        { firmId: "firm-a", tagName: "Smith Law" },
        { firmId: "firm-b", tagName: "Smith Law" },
      ],
      [],
    );
    const rows = planLeadWrites([leadOf({ tags: ["Smith Law"] })], index, { now: NOW });
    expect(rows.map((r) => r.firmId)).toEqual(["firm-a", "firm-b"]);
    expect(rows.every((r) => r.needsReview === false)).toBe(true);
  });

  it("falls back to the CallRail company mapping", () => {
    const index = buildRoutingIndex([], [{ firmId: "firm-a", callrailCompanyId: "COM1" }]);
    const rows = planLeadWrites([leadOf({ tags: ["Voicemail"] })], index, { now: NOW });
    expect(rows).toHaveLength(1);
    expect(rows[0].firmId).toBe("firm-a");
    expect(rows[0].needsReview).toBe(false);
  });

  it("UNASSIGNED lands in the admin queue with needsReview set", () => {
    const rows = planLeadWrites([leadOf()], buildRoutingIndex([], []), { now: NOW });
    expect(rows).toHaveLength(1);
    expect(rows[0].firmId).toBeNull();
    expect(rows[0].needsReview).toBe(true);
    expect(rows[0].parseFailed).toBe(false);
  });

  // Without this the next run would insert an unassigned twin beside the row
  // the admin just assigned, forever.
  it("refreshes an admin-assigned row instead of re-creating a queue twin", () => {
    const assigned = new Map([[leadKey("c1", "p1"), ["firm-z"]]]);
    const rows = planLeadWrites([leadOf()], buildRoutingIndex([], []), {
      now: NOW,
      assignedFirmIds: assigned,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].firmId).toBe("firm-z");
    expect(rows[0].needsReview).toBe(false);
  });
});

describe("planLeadWrites — parsing and status", () => {
  const index = buildRoutingIndex([], [{ firmId: "firm-a", callrailCompanyId: "COM1" }]);

  it("takes name and phone from the note, not caller ID", () => {
    const [row] = planLeadWrites([leadOf()], index, { now: NOW });
    expect(row.nameParsed).toBe("Jane Doe");
    expect(row.phoneParsed).toBe("555-123-4567");
    expect(row.customerPhoneCallerid).toBe("555-000-1111");
  });

  it("falls back to customer_name when the note yields no name", () => {
    const [row] = planLeadWrites([leadOf({ note: "Jane Doe," })], index, { now: NOW });
    expect(row.nameParsed).toBe("Jane Doe");
    expect(row.phoneParsed).toBe("555-000-1111");
  });

  it("a PARSE FAILURE still produces a lead, flagged for the queue", () => {
    const [row] = planLeadWrites(
      [leadOf({ note: "Jane 555-111-2222 John 555-333-4444" })],
      index,
      { now: NOW },
    );
    expect(row.parseFailed).toBe(true);
    expect(row.parseError).toMatch(/^multiple_phone_numbers: /);
    expect(row.needsReview).toBe(true);
    // Still recovers what it can, so the admin has something to work with.
    expect(row.nameParsed).toBe("Fallback Name");
    expect(row.phoneParsed).toBe("555-000-1111");
  });

  it("splits a multi-person note into p1/p2 with their own statuses", () => {
    const rows = planLeadWrites(
      [
        leadOf({
          note: "Jane Doe, 555-111-2222, Signed; John Roe, 555-333-4444, Lost",
          tags: ["2 Person"],
        }),
      ],
      index,
      { now: NOW },
    );
    expect(rows.map((r) => r.personSuffix)).toEqual(["p1", "p2"]);
    expect(rows.map((r) => r.statusParsed)).toEqual(["signed", "pending"]);
    expect(rows.map((r) => r.statusTagMatched)).toEqual(["Signed", "Lost"]);
  });

  it("unions a lead-level Opportunity tag across every person", () => {
    const rows = planLeadWrites(
      [
        leadOf({
          note: "Jane Doe, 555-111-2222, Lost; John Roe, 555-333-4444, Lost",
          tags: ["2 Person", "Opportunity"],
        }),
      ],
      index,
      { now: NOW },
    );
    expect(rows.every((r) => r.isOpportunityParsed)).toBe(true);
  });

  it("sets signedAt and suggests the status when the tags say Signed", () => {
    const [row] = planLeadWrites([leadOf({ tags: ["Signed"] })], index, { now: NOW });
    expect(row.statusParsed).toBe("signed");
    expect(row.suggestedStatus).toBe("signed");
    expect(row.signedAt).toEqual(NOW);
  });

  it("leaves signedAt null for a pending lead", () => {
    const [row] = planLeadWrites([leadOf({ tags: ["Lost"] })], index, { now: NOW });
    expect(row.statusParsed).toBe("pending");
    expect(row.signedAt).toBeNull();
  });

  // The structural half of "admin overrides are never overwritten": the
  // writer has no field to name, so it cannot reach them by mistake.
  it.each([
    "nameOverride",
    "phoneOverride",
    "statusOverride",
    "isOpportunityOverride",
    "firstSeenAt",
  ])("a planned row has no %s field at all", (key) => {
    const [row] = planLeadWrites([leadOf()], index, { now: NOW });
    expect(row).not.toHaveProperty(key);
  });
});

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

describe("syncLeadsForMonth", () => {
  it("writes a lead, then a RE-RUN changes nothing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
    const fake = makeFakeStore({
      companyRules: [{ firmId: "firm-a", callrailCompanyId: "COM1" }],
    });
    const deps = makeDeps(fake.store, { fetchCalls: async () => [CALL() as never] });

    const first = await syncLeadsForMonth(deps, { triggeredBy: "scheduled" });
    expect(first.calls.written).toBe(1);
    expect(fake.rows.size).toBe(1);
    const afterFirst = JSON.stringify([...fake.rows.keys()]);

    const second = await syncLeadsForMonth(deps, { triggeredBy: "scheduled" });
    expect(second.calls.written).toBe(1);
    expect(fake.rows.size).toBe(1); // upserted, not duplicated
    expect(JSON.stringify([...fake.rows.keys()])).toBe(afterFirst);
  });

  it("never replaces an existing signedAt with a later sync's clock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
    const fake = makeFakeStore({
      companyRules: [{ firmId: "firm-a", callrailCompanyId: "COM1" }],
    });
    const t1 = new Date("2026-10-14T15:00:00Z");
    const t2 = new Date("2026-10-15T15:00:00Z");
    let clock = t1;
    const deps = makeDeps(fake.store, {
      fetchCalls: async () => [CALL() as never],
      now: () => clock,
    });

    await syncLeadsForMonth(deps, {});
    clock = t2;
    await syncLeadsForMonth(deps, {});

    const row = [...fake.rows.values()][0];
    expect(row.signedAt).toEqual(t1);
    expect(row.signedAtSource).toBe("sync");
  });

  it("an UNASSIGNED lead lands in the queue and stays one row across runs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
    const fake = makeFakeStore();
    const deps = makeDeps(fake.store, { fetchCalls: async () => [CALL() as never] });

    await syncLeadsForMonth(deps, {});
    await syncLeadsForMonth(deps, {});

    expect(fake.rows.size).toBe(1);
    const row = [...fake.rows.values()][0];
    expect(row.firmId).toBeNull();
    expect(row.needsReview).toBe(true);
  });

  it("a PARSE FAILURE lands in the queue even when a firm resolved", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
    const fake = makeFakeStore({
      companyRules: [{ firmId: "firm-a", callrailCompanyId: "COM1" }],
    });
    const deps = makeDeps(fake.store, {
      fetchCalls: async () => [CALL({ note: "Jane 555-111-2222 John 555-333-4444" }) as never],
    });

    const r = await syncLeadsForMonth(deps, {});
    expect(r.calls.parseFailed).toBe(1);
    const row = [...fake.rows.values()][0];
    expect(row.firmId).toBe("firm-a");
    expect(row.needsReview).toBe(true);
  });

  describe("the previous-month pass", () => {
    it("does NOT fetch the previous window when nothing is still pending", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
      const fake = makeFakeStore();
      const windows: string[] = [];
      const deps = makeDeps(fake.store, {
        fetchCalls: async (_c, from) => {
          windows.push(from);
          return [];
        },
      });

      await syncLeadsForMonth(deps, {});
      expect(windows).toEqual(["2026-10-01"]);
    });

    // A September call signed in October is invisible to the month-to-date
    // window, because CallRail filters on the CALL time, not the tag time.
    it("re-checks a still-pending previous-month lead and picks up its Signed tag", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
      const fake = makeFakeStore({
        companyRules: [{ firmId: "firm-a", callrailCompanyId: "COM1" }],
        pending: { call: ["c-sept"] },
      });
      const windows: string[] = [];
      const deps = makeDeps(fake.store, {
        fetchCalls: async (_c, from) => {
          windows.push(from);
          if (from === "2026-09-01") {
            return [
              CALL({
                id: "c-sept",
                start_time: "2026-09-28T14:00:00.000-04:00",
                tags: ["Signed"],
              }) as never,
              // Not pending in our DB, so it must be ignored.
              CALL({ id: "c-other", start_time: "2026-09-10T14:00:00.000-04:00" }) as never,
            ];
          }
          return [];
        },
      });

      const r = await syncLeadsForMonth(deps, {});
      expect(windows).toEqual(["2026-10-01", "2026-09-01"]);
      expect(r.calls.recheckedFromPreviousMonth).toBe(1);

      const ids = [...fake.rows.values()].map((x) => x.callrailId);
      expect(ids).toEqual(["c-sept"]);
      expect([...fake.rows.values()][0].signedAt).not.toBeNull();
    });
  });

  describe("dry run", () => {
    it("writes nothing, opens no job, and returns masked counts and fields", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
      const fake = makeFakeStore({
        companyRules: [{ firmId: "firm-a", callrailCompanyId: "COM1" }],
      });
      const deps = makeDeps(fake.store, { fetchCalls: async () => [CALL() as never] });

      const r = await syncLeadsForMonth(deps, { dryRun: true });

      expect(fake.rows.size).toBe(0);
      expect(fake.jobs).toHaveLength(0);
      expect(fake.counts.upserts).toBe(0);
      expect(r.dryRun).toBe(true);
      expect(r.calls.planned).toBe(1);
      expect(r.calls.written).toBe(0);
      // The point of the dry run: prove which field names CallRail returned.
      expect(r.calls.fieldsSeen).toContain("customer_phone_number");
      expect(r.calls.fieldsSeen).toContain("start_time");
      expect(r.sample[0].name).toBe("J*** D**");
      expect(r.sample[0].phone).toBe("***4567");
    });
  });

  describe("job rows and source independence", () => {
    it("opens one job per source and completes both", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
      const fake = makeFakeStore();
      await syncLeadsForMonth(makeDeps(fake.store), { triggeredBy: "scheduled" });
      expect(fake.jobs.map((j) => [j.kind, j.status])).toEqual([
        ["callrail_calls", "completed"],
        ["callrail_forms", "completed"],
      ]);
      expect(fake.jobs.every((j) => j.triggeredBy === "scheduled")).toBe(true);
    });

    it("a FORMS failure never marks the calls ingestion failed", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
      const fake = makeFakeStore({
        companyRules: [{ firmId: "firm-a", callrailCompanyId: "COM1" }],
      });
      const deps = makeDeps(fake.store, {
        fetchCalls: async () => [CALL() as never],
        fetchForms: async () => {
          throw new Error("CallRail request failed: 400 unknown field");
        },
      });

      const r = await syncLeadsForMonth(deps, {});
      expect(r.calls.error).toBeNull();
      expect(r.calls.written).toBe(1);
      expect(r.forms.error).toMatch(/unknown field/);
      expect(fake.jobs.map((j) => j.status)).toEqual(["completed", "failed"]);
      expect(fake.rows.size).toBe(1);
    });

    it("records a non-Error rejection as readable text, not undefined", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
      const fake = makeFakeStore();
      const deps = makeDeps(fake.store, {
        fetchCalls: async () => {
          throw { code: 429, detail: "rate limited" };
        },
      });
      const r = await syncLeadsForMonth(deps, {});
      expect(r.calls.error).toBe('{"code":429,"detail":"rate limited"}');
      expect(fake.jobs[0].errorMessage).toBe('{"code":429,"detail":"rate limited"}');
    });
  });
});

// ---------------------------------------------------------------------------
// Masking and error text
// ---------------------------------------------------------------------------

describe("masking", () => {
  it.each([
    ["Jane Doe", "J*** D**"],
    ["Jane", "J***"],
    ["A", "A*"],
    [null, null],
  ])("maskName(%s) -> %s", (input, expected) => {
    expect(maskName(input as string | null)).toBe(expected);
  });

  it.each([
    ["555-123-4567", "***4567"],
    ["(555) 123-4567", "***4567"],
    ["12", "***"],
    [null, null],
  ])("maskPhone(%s) -> %s", (input, expected) => {
    expect(maskPhone(input as string | null)).toBe(expected);
  });

  it("a masked sample never carries a full name or phone", () => {
    const index = buildRoutingIndex([], [{ firmId: "f", callrailCompanyId: "COM1" }]);
    const [row] = planLeadWrites([leadOf()], index, { now: NOW });
    expect(maskName(row.nameParsed)).not.toContain("ane");
    expect(maskPhone(row.phoneParsed)).not.toContain("555-123");
  });
});

describe("stringifyError", () => {
  it.each([
    [new Error("boom"), "boom"],
    ["plain string", "plain string"],
    [{ a: 1 }, '{"a":1}'],
  ])("%s -> %s", (input, expected) => {
    expect(stringifyError(input)).toBe(expected);
  });

  it("survives a value JSON cannot serialise", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(typeof stringifyError(circular)).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Dry-run parse-failure diagnostics
// ---------------------------------------------------------------------------

describe("redactNoteStructure", () => {
  it("reduces every word to its initial and every digit to #", () => {
    expect(redactNoteStructure("Jane Doe; maiden name Smith, 555-123-4567")).toBe(
      "J. D.; m. n. S., ###-###-####",
    );
  });

  it.each([
    ["Jane Doe, 555-123-4567", "J. D., ###-###-####"],
    ["A B", "A. B."],
    ["No Name, No Number", "N. N., N. N."],
    ["jane (cell) doe", "j. (c.) d."],
    ["Jane Doe | referred by Acme", "J. D. | r. b. A."],
    ["", ""],
  ])("%s -> %s", (input, expected) => {
    expect(redactNoteStructure(input)).toBe(expected);
  });

  it("preserves case, so capitalisation structure survives", () => {
    expect(redactNoteStructure("jane DOE")).toBe("j. D.");
  });

  it("handles accented letters as single words", () => {
    expect(redactNoteStructure("José Ríos, 5551234567")).toBe("J. R., ##########");
  });

  it.each([[null], [undefined]])("%s -> null", (v) => {
    expect(redactNoteStructure(v as string | null)).toBeNull();
  });

  // The guarantee the whole feature rests on.
  it("leaves no readable name and no dialable number", () => {
    const out = redactNoteStructure(
      "Jane Doe 555-111-2222 John Roe 555-333-4444",
    ) as string;
    expect(out).toBe("J. D. ###-###-#### J. R. ###-###-####");
    for (const leak of ["Jane", "Doe", "John", "Roe", "555", "111", "2222"]) {
      expect(out).not.toContain(leak);
    }
    expect(out).not.toMatch(/\d/);
    // No word longer than one letter survives.
    expect(out).not.toMatch(/\p{L}\p{L}/u);
  });
});

describe("dry-run parse-failure tally", () => {
  const BAD_NOTE = "Jane Doe 555-111-2222 John Roe 555-333-4444";

  async function dryRunWith(calls: unknown[], over: Parameters<typeof makeFakeStore>[0] = {}) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
    const fake = makeFakeStore(over);
    const deps = makeDeps(fake.store, { fetchCalls: async () => calls as never });
    const r = await syncLeadsForMonth(deps, { dryRun: true });
    return { r, fake };
  }

  it("tallies by reason and samples the note shape", async () => {
    const { r } = await dryRunWith([
      CALL({ id: "c1", note: BAD_NOTE }),
      CALL({ id: "c2", note: "Jane Doe" }),
      CALL({ id: "c3", note: "Jane Doe, 555-111-2222; John Roe" }),
    ]);

    expect(r.calls.parseFailed).toBe(3);
    expect(r.calls.parseFailureReasons).toEqual({
      multiple_phone_numbers: 1,
      unparseable: 1,
      person_missing_name_or_phone: 1,
    });
    expect(r.calls.noteStructures).toHaveLength(3);
  });

  it("flags which failures came from a semicolon", async () => {
    const { r } = await dryRunWith([
      CALL({ id: "c1", note: "Jane Doe, 555-111-2222; John Roe" }),
      CALL({ id: "c2", note: BAD_NOTE }),
    ]);
    const bySemicolon = r.calls.noteStructures.filter((n) => n.hasSemicolon);
    expect(bySemicolon).toHaveLength(1);
    expect(bySemicolon[0].callrailId).toBe("c1");
    expect(bySemicolon[0].noteStructure).toBe("J. D., ###-###-####; J. R.");
  });

  it("carries the reason WITHOUT its detail — the detail can quote note text", async () => {
    const { r } = await dryRunWith([CALL({ id: "c1", note: BAD_NOTE })]);
    expect(r.calls.noteStructures[0].reason).toBe("multiple_phone_numbers");
    expect(r.calls.noteStructures[0].reason).not.toContain(":");
  });

  // A lead copied to three firms is three rows but ONE failure.
  it("counts distinct leads, not planned rows", async () => {
    const { r } = await dryRunWith([CALL({ id: "c1", note: BAD_NOTE, tags: ["Shared"] })], {
      tagRules: [
        { firmId: "firm-a", tagName: "Shared" },
        { firmId: "firm-b", tagName: "Shared" },
        { firmId: "firm-c", tagName: "Shared" },
      ],
    });
    expect(r.calls.planned).toBe(3);
    expect(r.calls.parseFailureReasons).toEqual({ multiple_phone_numbers: 1 });
    expect(r.calls.noteStructures).toHaveLength(1);
  });

  it(`caps the samples at ${NOTE_STRUCTURE_SAMPLE_CAP} but keeps counting`, async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      CALL({ id: `c${i}`, note: BAD_NOTE }),
    );
    const { r } = await dryRunWith(many);
    expect(r.calls.parseFailureReasons.multiple_phone_numbers).toBe(25);
    expect(r.calls.noteStructures).toHaveLength(NOTE_STRUCTURE_SAMPLE_CAP);
  });

  it("no sample carries a name or a phone", async () => {
    const { r } = await dryRunWith([CALL({ id: "c1", note: BAD_NOTE })]);
    const blob = JSON.stringify(r.calls.noteStructures);
    for (const leak of ["Jane", "Doe", "John", "Roe", "555", "4444"]) {
      expect(blob).not.toContain(leak);
    }
  });

  // The real path must be untouched by any of this.
  it("a REAL run populates neither field and still writes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
    const fake = makeFakeStore({
      companyRules: [{ firmId: "firm-a", callrailCompanyId: "COM1" }],
    });
    const deps = makeDeps(fake.store, {
      fetchCalls: async () => [CALL({ note: BAD_NOTE }) as never],
    });

    const r = await syncLeadsForMonth(deps, { triggeredBy: "scheduled" });

    expect(r.calls.parseFailed).toBe(1);
    expect(r.calls.parseFailureReasons).toEqual({});
    expect(r.calls.noteStructures).toEqual([]);
    expect(r.calls.written).toBe(1);
    expect(fake.rows.size).toBe(1);
  });

  it("is empty on both sources when nothing fails to parse", async () => {
    const { r } = await dryRunWith([CALL({ id: "c1" })]);
    expect(r.calls.parseFailureReasons).toEqual({});
    expect(r.calls.noteStructures).toEqual([]);
    expect(r.forms.parseFailureReasons).toEqual({});
    expect(r.forms.noteStructures).toEqual([]);
  });
});
