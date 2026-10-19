import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { presetRange } from "@/lib/portal/range";
import { inRange, monthAnchor } from "@/lib/portal/visibility";
import { toIsoDateEastern } from "@/lib/date-utils";
import {
  FETCH_BUDGET_MS,
  newLeadWindowStart,
  STALE_JOB_MESSAGE,
  STALE_JOB_MINUTES,
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
import { queueReason } from "./reconcile";
import type { LeadSource, LeadStore, PlannedLead } from "./types";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

type StoredRow = PlannedLead & {
  id: string;
  signedAtSource: string | null;
  firstSeenAt: Date;
  lastSyncedAt: Date;
  hasOverrides: boolean;
  hasNotes: boolean;
};

/**
 * Mirrors the real store's semantics: the same conflict keys, signed_at
 * applied with coalesce(existing, new), and — since step 2 — repointing as
 * an UPDATE that keeps the row's identity, so "notes and overrides survive a
 * move" is actually exercised rather than assumed.
 */
function makeFakeStore(
  opts: {
    tagRules?: { firmId: string; tagName: string }[];
    companyRules?: { firmId: string; callrailCompanyId: string }[];
    pending?: Partial<Record<LeadSource, string[]>>;
    seed?: StoredRow[];
    /** Job rows already in lead_sync_jobs before this run. */
    seedJobs?: { kind: string; status: string; startedAt: Date }[];
    /** to_date of the last COMPLETED job, per kind. */
    lastCompleted?: Partial<Record<string, string>>;
  } = {},
) {
  const rows = new Map<string, StoredRow>();
  const keyOf = (r: { firmId: string | null; callrailId: string; personSuffix: string }) =>
    `${r.firmId ?? "null"}|${r.callrailId}|${r.personSuffix}`;
  for (const r of opts.seed ?? []) rows.set(keyOf(r), r);

  const jobs: {
    kind: string;
    status: string;
    triggeredBy: string;
    errorMessage: string | null;
    leadsIngested: number;
    startedAt?: Date;
    toDate?: string;
    finishedSeq?: number;
  }[] = (opts.seedJobs ?? []).map((j) => ({
    kind: j.kind,
    status: j.status,
    triggeredBy: "scheduled",
    errorMessage: null,
    leadsIngested: 0,
    startedAt: j.startedAt,
  }));
  const counts = { pendingLookups: 0, applies: 0 };
  let nextId = 1;
  let finishSeq = 0;

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
    async findFirmPhoneIndex(firmIds) {
      return [...rows.values()]
        .filter((r) => r.firmId !== null && firmIds.includes(r.firmId))
        .map((r) => ({
          leadId: r.id,
          firmId: r.firmId as string,
          callrailId: r.callrailId,
          phone: r.phoneParsed,
        }));
    },
    async findExistingLeadRows(ids) {
      return [...rows.values()]
        .filter((r) => ids.includes(r.callrailId))
        .map((r) => ({
          id: r.id,
          firmId: r.firmId,
          callrailId: r.callrailId,
          personSuffix: r.personSuffix,
          hasOverrides: r.hasOverrides,
          hasNotes: r.hasNotes,
        }));
    },
    async applyReconciliation(plan) {
      counts.applies += 1;
      const now = new Date();

      // Repoints move the row to a new key WITHOUT losing its identity,
      // which is the whole point of promoting rather than inserting.
      const byId = new Map([...rows.values()].map((r) => [r.id, r]));
      for (const rp of plan.repoint) {
        const row = byId.get(rp.rowId);
        if (!row) continue;
        rows.delete(keyOf(row));
        row.firmId = rp.toFirmId;
        row.needsReview = rp.toFirmId === null;
        rows.set(keyOf(row), row);
      }

      for (const r of plan.upsert) {
        const key = keyOf(r);
        const existing = rows.get(key);
        if (!existing) {
          rows.set(key, {
            ...r,
            id: `row-${nextId++}`,
            signedAtSource: r.signedAt ? "sync" : null,
            firstSeenAt: now,
            lastSyncedAt: now,
            hasOverrides: false,
            hasNotes: false,
          });
          continue;
        }
        rows.set(key, {
          ...existing,
          ...r,
          id: existing.id,
          signedAt: existing.signedAt ?? r.signedAt,
          signedAtSource: existing.signedAt
            ? existing.signedAtSource
            : r.signedAt
              ? "sync"
              : existing.signedAtSource,
          firstSeenAt: existing.firstSeenAt,
          lastSyncedAt: now,
          hasOverrides: existing.hasOverrides,
          hasNotes: existing.hasNotes,
        });
      }

      for (const id of plan.deleteRowIds) {
        const row = [...rows.values()].find((r) => r.id === id);
        if (row) rows.delete(keyOf(row));
      }
      for (const id of plan.flagStaleRowIds) {
        const row = [...rows.values()].find((r) => r.id === id);
        if (row) row.needsReview = true;
      }

      return {
        written: plan.upsert.length,
        repointed: plan.repoint.length,
        deleted: plan.deleteRowIds.length,
        flagged: plan.flagStaleRowIds.length,
      };
    },
    async lastCompletedJobToDate(kind) {
      if (opts.lastCompleted) return opts.lastCompleted[kind] ?? null;
      // Mirrors buildLastCompletedJobQuery: completed AND scheduled, newest finish first.
      const done = jobs
        .filter((j) => j.kind === kind && j.status === "completed" && j.triggeredBy === "scheduled")
        .sort((a, b) => (b.finishedSeq ?? 0) - (a.finishedSeq ?? 0));
      return done[0]?.toDate ?? null;
    },
    async failStaleJobs({ startedBefore, message }) {
      let n = 0;
      for (const j of jobs) {
        if (j.status === "running" && j.startedAt && j.startedAt < startedBefore) {
          j.status = "failed";
          j.errorMessage = message;
          n += 1;
        }
      }
      return n;
    },
    async startJob(i) {
      jobs.push({
        kind: i.kind,
        status: "running",
        triggeredBy: i.triggeredBy,
        errorMessage: null,
        leadsIngested: 0,
        toDate: i.toDate,
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
        finishedSeq: ++finishSeq,
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

  // CHANGED in step 2. This used to assert that the planner kept a row whose
  // routing had gone quiet, via an assigned-firm guard. That guard existed
  // for an admin-assign action the admin surface does not have — admins set
  // status, opportunity, name and phone, never firm_id — so routing is
  // authoritative and the planner reports exactly what routing says. What
  // happens to a row that no longer matches is reconcileLeadRows' decision,
  // covered in reconcile.test.ts.
  it("reports what routing says and nothing else", () => {
    const rows = planLeadWrites([leadOf()], buildRoutingIndex([], []), { now: NOW });
    expect(rows).toHaveLength(1);
    expect(rows[0].firmId).toBeNull();
    expect(rows[0].needsReview).toBe(true);
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

  describe("a person's status word that matches nothing on the ladder falls back to the call's tags", () => {
    const people = (tags: string[], note: string) =>
      planLeadWrites([leadOf({ tags, note })], index, { now: NOW }).map((r) => ({
        status: r.statusParsed,
        tag: r.statusTagMatched,
        opp: r.isOpportunityParsed,
        signedAt: r.signedAt,
      }));

    it("a typo'd word on a call tagged Signed → Signed", () => {
      const [jane, john] = people(["2 Person", "Signed"], "Jane Doe, 555-111-2222, Signd; John Roe, 555-333-4444, Pending");
      expect(jane).toEqual({ status: "signed", tag: "Signed", opp: false, signedAt: NOW });
      expect(john).toEqual({ status: "pending", tag: "Pending", opp: false, signedAt: null });
    });

    it("an unknown word on a call with no status tag → Opportunity (default pending, no matched tag)", () => {
      const [jane] = people(["2 Person", "Opportunity"], "Jane Doe, 555-111-2222, Retained; John Roe, 555-333-4444, Signed");
      expect(jane).toEqual({ status: "pending", tag: null, opp: true, signedAt: null });
    });

    it("a known word still overrides the call's tags: Signed over a Pending call", () => {
      const [jane] = people(["2 Person", "Pending"], "Jane Doe, 555-111-2222, Signed; John Roe, 555-333-4444, Signd");
      expect(jane).toEqual({ status: "signed", tag: "Signed", opp: false, signedAt: NOW });
    });

    it("a known word still overrides the call's tags: Pending over a Signed call", () => {
      const [jane] = people(["2 Person", "Signed"], "Jane Doe, 555-111-2222, Pending; John Roe, 555-333-4444, Signed");
      expect(jane).toEqual({ status: "pending", tag: "Pending", opp: false, signedAt: null });
    });

    it("a known hidden word (Lost) still overrides a Signed call — only unknown words fall back", () => {
      const [jane] = people(["2 Person", "Signed"], "Jane Doe, 555-111-2222, Lost; John Roe, 555-333-4444, Signed");
      expect(jane).toEqual({ status: "pending", tag: "Lost", opp: false, signedAt: null });
    });

    it("a person whose own word is Opportunity keeps the flag and takes the call's status", () => {
      const [jane] = people(["2 Person", "Signed"], "Jane Doe, 555-111-2222, Opportunity; John Roe, 555-333-4444, Signed");
      expect(jane).toEqual({ status: "signed", tag: "Signed", opp: true, signedAt: NOW });
    });
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

  // CHANGED in step 2. Before reconciliation this produced TWO rows — the
  // queue row and a new firm row — because the two uniqueness rules cannot
  // see each other. It is the case that would have doubled every existing
  // unassigned lead the moment firms were configured.
  it("PROMOTES the queue row when routing starts matching, keeping one row", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
    const fake = makeFakeStore();
    const deps = makeDeps(fake.store, { fetchCalls: async () => [CALL() as never] });

    await syncLeadsForMonth(deps, {});
    expect(fake.rows.size).toBe(1);
    const before = [...fake.rows.values()][0];
    expect(before.firmId).toBeNull();

    // A firm is configured between runs.
    const routed = makeFakeStore({
      companyRules: [{ firmId: "firm-a", callrailCompanyId: "COM1" }],
      seed: [...fake.rows.values()],
    });
    const r = await syncLeadsForMonth(
      makeDeps(routed.store, { fetchCalls: async () => [CALL() as never] }),
      {},
    );

    expect(routed.rows.size).toBe(1);
    const after = [...routed.rows.values()][0];
    expect(after.firmId).toBe("firm-a");
    expect(after.needsReview).toBe(false);
    // Same row, so anything a human wrote on it while it sat in the queue
    // travels with it.
    expect(after.id).toBe(before.id);
    expect(r.calls.repointed).toBe(1);
  });

  it("MOVES a lead that changes firm, and the old firm stops seeing it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
    const seeded = makeFakeStore({
      companyRules: [{ firmId: "firm-a", callrailCompanyId: "COM1" }],
    });
    await syncLeadsForMonth(
      makeDeps(seeded.store, { fetchCalls: async () => [CALL() as never] }),
      {},
    );
    const before = [...seeded.rows.values()][0];
    expect(before.firmId).toBe("firm-a");

    const remapped = makeFakeStore({
      companyRules: [{ firmId: "firm-b", callrailCompanyId: "COM1" }],
      seed: [...seeded.rows.values()],
    });
    const r = await syncLeadsForMonth(
      makeDeps(remapped.store, { fetchCalls: async () => [CALL() as never] }),
      {},
    );

    expect(remapped.rows.size).toBe(1);
    const after = [...remapped.rows.values()][0];
    expect(after.firmId).toBe("firm-b");
    expect(after.id).toBe(before.id);
    expect(r.calls.repointed).toBe(1);
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
      expect(fake.counts.applies).toBe(0);
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

// ---------------------------------------------------------------------------
// Tag filter: echoed, probed on the dry run only
// ---------------------------------------------------------------------------

describe("the tag filter in a sync result", () => {
  const probe = (kind: "calls" | "forms") => ({
    companyId: "COM1",
    path: kind === "calls" ? "calls.json" : "form_submissions.json",
    unfiltered: 790,
    singleTag: 12,
    singleTagName: "Opportunity",
    allTags: 25,
    semantics: "or" as const,
    explanation: "ok",
  });

  it("echoes the nine tags every fetch is filtered to", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
    const fake = makeFakeStore();
    const r = await syncLeadsForMonth(makeDeps(fake.store), { dryRun: true });
    expect([...r.tagFilter]).toEqual([
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

  it("probes ONE company on a dry run, for calls and forms", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
    const fake = makeFakeStore();
    const seen: string[][] = [];
    const deps = makeDeps(fake.store, {
      listCompanyIds: async () => ["COM1", "COM2", "COM3"],
      probeTagFilter: async (kind, companyId) => {
        seen.push([kind, companyId]);
        return probe(kind);
      },
    });

    const r = await syncLeadsForMonth(deps, { dryRun: true });
    expect(seen).toEqual([
      ["calls", "COM1"],
      ["forms", "COM1"],
    ]);
    expect(r.tagFilterProbe.calls?.semantics).toBe("or");
    expect(r.tagFilterProbe.forms?.path).toBe("form_submissions.json");
  });

  it("never probes on a REAL run", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
    const fake = makeFakeStore();
    let probed = 0;
    const deps = makeDeps(fake.store, {
      probeTagFilter: async (kind) => {
        probed += 1;
        return probe(kind);
      },
    });

    const r = await syncLeadsForMonth(deps, { triggeredBy: "scheduled" });
    expect(probed).toBe(0);
    expect(r.tagFilterProbe).toEqual({ calls: null, forms: null });
  });

  // The probe is a diagnostic. It must never be the reason a run fails.
  it("a failing probe leaves the dry run intact", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
    const fake = makeFakeStore({
      companyRules: [{ firmId: "firm-a", callrailCompanyId: "COM1" }],
    });
    const deps = makeDeps(fake.store, {
      fetchCalls: async () => [CALL() as never],
      probeTagFilter: async () => {
        throw new Error("probe blew up");
      },
    });

    const r = await syncLeadsForMonth(deps, { dryRun: true });
    expect(r.tagFilterProbe).toEqual({ calls: null, forms: null });
    expect(r.calls.planned).toBe(1);
    expect(r.calls.error).toBeNull();
  });

  it("skips the probe when no company was fetched", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
    const fake = makeFakeStore();
    let probed = 0;
    const deps = makeDeps(fake.store, {
      listCompanyIds: async () => [],
      probeTagFilter: async (kind) => {
        probed += 1;
        return probe(kind);
      },
    });
    await syncLeadsForMonth(deps, { dryRun: true });
    expect(probed).toBe(0);
  });
});

describe("an empty note on a TAGGED record", () => {
  // The filter stops untagged records being fetched at all. A record that IS
  // tagged but has no note is a different thing: a real lead somebody failed
  // to write up, so it still goes to the queue rather than being dropped.
  it("is still a parse failure bound for the admin queue", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
    const fake = makeFakeStore({
      companyRules: [{ firmId: "firm-a", callrailCompanyId: "COM1" }],
    });
    const deps = makeDeps(fake.store, {
      fetchCalls: async () => [CALL({ note: null, tags: ["Signed"] }) as never],
    });

    const r = await syncLeadsForMonth(deps, { triggeredBy: "scheduled" });
    expect(r.calls.parseFailed).toBe(1);

    const row = [...fake.rows.values()][0];
    expect(row.parseError).toBe("empty_note");
    expect(row.needsReview).toBe(true);
    expect(row.firmId).toBe("firm-a");
    // The tag still gives it a status, and the fallbacks still give a name.
    expect(row.statusParsed).toBe("signed");
    expect(row.nameParsed).toBe("Fallback Name");
  });

  it("is tallied under empty_note on a dry run, with a null note shape", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
    const fake = makeFakeStore();
    const deps = makeDeps(fake.store, {
      fetchCalls: async () => [CALL({ note: null, tags: ["Signed"] }) as never],
    });

    const r = await syncLeadsForMonth(deps, { dryRun: true });
    expect(r.calls.parseFailureReasons).toEqual({ empty_note: 1 });
    expect(r.calls.noteStructures[0]).toMatchObject({
      reason: "empty_note",
      hasSemicolon: false,
      noteStructure: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Soft dedup, through the real orchestration
// ---------------------------------------------------------------------------

describe("soft dedup in a real run", () => {
  const COMPANY = [{ firmId: "firm-a", callrailCompanyId: "COM1" }];

  it("flags a second lead sharing a phone at the same firm, on the NEXT run", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));

    // Run 1: one lead lands and is stored.
    const first = makeFakeStore({ companyRules: COMPANY });
    await syncLeadsForMonth(
      makeDeps(first.store, { fetchCalls: async () => [CALL({ id: "c1" }) as never] }),
      {},
    );
    expect(first.rows.size).toBe(1);

    // Run 2: a different call, same person's number, same firm.
    const second = makeFakeStore({
      companyRules: COMPANY,
      seed: [...first.rows.values()],
    });
    const r = await syncLeadsForMonth(
      makeDeps(second.store, {
        fetchCalls: async () => [
          CALL({ id: "c1" }) as never,
          CALL({ id: "c2", note: "Jane Doe, (555) 123-4567" }) as never,
        ],
      }),
      {},
    );

    expect(r.calls.possibleDuplicates).toBe(1);
    const flagged = [...second.rows.values()].find((x) => x.callrailId === "c2");
    expect(flagged?.possibleDuplicateOf).toBeTruthy();
    // FLIPPED (C8): was needsReview true. A duplicate is flagged for staff but
    // NOT hidden from the firm.
    expect(flagged?.needsReview).toBe(false);
    // Flagged, never blocked — both rows are written.
    expect(second.rows.size).toBe(2);
  });

  it("does not flag anything on a first run with nothing on file", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
    const fake = makeFakeStore({ companyRules: COMPANY });
    const r = await syncLeadsForMonth(
      makeDeps(fake.store, { fetchCalls: async () => [CALL() as never] }),
      {},
    );
    expect(r.calls.possibleDuplicates).toBe(0);
  });

  it("does not flag an unassigned lead — there is no firm to duplicate within", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
    const fake = makeFakeStore();
    const r = await syncLeadsForMonth(
      makeDeps(fake.store, {
        fetchCalls: async () => [
          CALL({ id: "c1" }) as never,
          CALL({ id: "c2" }) as never,
        ],
      }),
      {},
    );
    expect(r.calls.possibleDuplicates).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// C8: needs_review means "hidden from clients" — and nothing else
// ---------------------------------------------------------------------------

describe("needs_review means hidden from clients", () => {
  it("a stale-routing row keeps needs_review across syncs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
    // Run 1: the lead is tagged for two firms, so both get a row.
    const both = makeFakeStore({
      tagRules: [
        { firmId: "firm-a", tagName: "Shared" },
        { firmId: "firm-b", tagName: "Shared" },
      ],
    });
    const fetchCalls = async () => [CALL({ tags: ["Signed", "Shared"] }) as never];
    await syncLeadsForMonth(makeDeps(both.store, { fetchCalls }), {});
    expect(both.rows.size).toBe(2);

    // Someone writes a note on firm B's copy; then B's tag is removed.
    const seed = [...both.rows.values()].map((r) =>
      r.firmId === "firm-b" ? { ...r, hasNotes: true } : r,
    );
    let rows = seed;
    for (const run of [1, 2, 3]) {
      const fake = makeFakeStore({
        tagRules: [{ firmId: "firm-a", tagName: "Shared" }],
        seed: rows,
      });
      await syncLeadsForMonth(makeDeps(fake.store, { fetchCalls }), {});
      rows = [...fake.rows.values()];
      const b = rows.find((r) => r.firmId === "firm-b");
      const a = rows.find((r) => r.firmId === "firm-a");
      // Kept (it carries a note), and hidden — on EVERY run, not just the first.
      expect(b, `run ${run}`).toBeDefined();
      expect(b!.needsReview, `run ${run}`).toBe(true);
      // The firm routing still targets is untouched by it.
      expect(a!.needsReview, `run ${run}`).toBe(false);
    }
  });

  it("a stale row is still hidden — and labelled stale — when it is ALSO a duplicate", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
    const fetchCalls = async () => [CALL({ tags: ["Signed", "Shared"] }) as never];
    const both = makeFakeStore({
      tagRules: [
        { firmId: "firm-a", tagName: "Shared" },
        { firmId: "firm-b", tagName: "Shared" },
      ],
    });
    await syncLeadsForMonth(makeDeps(both.store, { fetchCalls }), {});
    // B's copy carries a note AND a duplicate flag; then B's tag goes away.
    const seed = [...both.rows.values()].map((r) =>
      r.firmId === "firm-b" ? { ...r, hasNotes: true, possibleDuplicateOf: "other-lead" } : r,
    );
    const fake = makeFakeStore({ tagRules: [{ firmId: "firm-a", tagName: "Shared" }], seed });
    await syncLeadsForMonth(makeDeps(fake.store, { fetchCalls }), {});

    const b = [...fake.rows.values()].find((r) => r.firmId === "firm-b")!;
    expect(b.needsReview).toBe(true);
    expect(
      queueReason({
        parseFailed: b.parseFailed,
        firmId: b.firmId,
        needsReview: b.needsReview,
        possibleDuplicateOf: b.possibleDuplicateOf,
      }),
    ).toBe("stale_routing");
  });

  // Not a leak: with NO surviving row for the firm routing now targets, the
  // stale row is MOVED there (same row, notes travel with it) — routing says
  // that is where the lead belongs, so becoming visible there is correct.
  it("a stale row with somewhere to go is moved, not left hidden", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
    const fetchCalls = async () => [CALL({ tags: ["Signed", "Shared"] }) as never];
    const onlyB = makeFakeStore({ tagRules: [{ firmId: "firm-b", tagName: "Shared" }] });
    await syncLeadsForMonth(makeDeps(onlyB.store, { fetchCalls }), {});
    const before = [...onlyB.rows.values()][0];

    const toA = makeFakeStore({
      tagRules: [{ firmId: "firm-a", tagName: "Shared" }],
      seed: [{ ...before, hasNotes: true }],
    });
    await syncLeadsForMonth(makeDeps(toA.store, { fetchCalls }), {});
    const rows = [...toA.rows.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(before.id);
    expect(rows[0].firmId).toBe("firm-a");
    expect(rows.some((r) => r.firmId === "firm-b")).toBe(false); // B no longer has it
  });

  it("a duplicate-flagged lead that is otherwise visible is NOT hidden", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
    const COMPANY = [{ firmId: "firm-a", callrailCompanyId: "COM1" }];
    const first = makeFakeStore({ companyRules: COMPANY });
    await syncLeadsForMonth(
      makeDeps(first.store, { fetchCalls: async () => [CALL({ id: "c1" }) as never] }),
      {},
    );
    const second = makeFakeStore({ companyRules: COMPANY, seed: [...first.rows.values()] });
    await syncLeadsForMonth(
      makeDeps(second.store, {
        fetchCalls: async () => [
          CALL({ id: "c1" }) as never,
          // Same caller, a second, genuinely Signed lead.
          CALL({ id: "c2", tags: ["Signed"], note: "Jane Doe, (555) 123-4567" }) as never,
        ],
      }),
      {},
    );
    const dup = [...second.rows.values()].find((r) => r.callrailId === "c2")!;
    expect(dup.possibleDuplicateOf).toBeTruthy(); // flagged for staff
    expect(dup.firmId).toBe("firm-a");            // routed
    expect(dup.statusParsed).toBe("signed");      // signed
    expect(dup.parseFailed).toBe(false);
    expect(dup.needsReview).toBe(false);          // and NOT hidden from the firm
  });
});

// ---------------------------------------------------------------------------
// Scope: which companies a run fetches
// ---------------------------------------------------------------------------

describe("syncLeadsForMonth — scope", () => {
  const FIRM_X = "firm-x";
  const FIRM_Y = "firm-y";

  function recordingDeps(store: LeadStore, calls: (company: string) => unknown[] = () => []) {
    const fetched: string[] = [];
    let listed = 0;
    const deps = makeDeps(store, {
      listCompanyIds: async () => {
        listed += 1;
        return ["COM1", "COM2", "UNSERVED1", "UNSERVED2"];
      },
      fetchCalls: async (companyId) => {
        fetched.push(`calls:${companyId}`);
        return calls(companyId) as never;
      },
      fetchForms: async (companyId) => {
        fetched.push(`forms:${companyId}`);
        return [];
      },
    });
    return { deps, fetched, listed: () => listed };
  }

  it("mapped: fetches only the companies mapped to a firm, and never lists the account", async () => {
    const fake = makeFakeStore({
      companyRules: [
        { firmId: FIRM_Y, callrailCompanyId: "COM2" },
        { firmId: FIRM_X, callrailCompanyId: "COM1" },
      ],
    });
    const r = recordingDeps(fake.store);
    const result = await syncLeadsForMonth(r.deps, { scope: "mapped", triggeredBy: "scheduled" });
    expect(result.scope).toBe("mapped");
    expect(result.companies).toBe(2);
    expect(r.listed()).toBe(0);
    expect([...new Set(r.fetched)].sort()).toEqual(["calls:COM1", "calls:COM2", "forms:COM1", "forms:COM2"]);
    expect(r.fetched.some((f) => f.includes("UNSERVED"))).toBe(false);
  });

  it("mapped: a company named twice is fetched once", async () => {
    const fake = makeFakeStore({
      companyRules: [
        { firmId: FIRM_X, callrailCompanyId: "COM1" },
        { firmId: FIRM_X, callrailCompanyId: " COM1 " },
      ],
    });
    const r = recordingDeps(fake.store);
    const result = await syncLeadsForMonth(r.deps, { scope: "mapped" });
    expect(result.companies).toBe(1);
    expect(r.fetched.filter((f) => f === "calls:COM1")).toHaveLength(1);
  });

  it("mapped: no mapped companies means nothing fetched and nothing written", async () => {
    const fake = makeFakeStore();
    const r = recordingDeps(fake.store);
    const result = await syncLeadsForMonth(r.deps, { scope: "mapped" });
    expect(result.companies).toBe(0);
    expect(r.fetched).toEqual([]);
    expect(fake.rows.size).toBe(0);
  });

  it("mapped: a firm-tagged lead on a mapped company still routes by its tag, not the company", async () => {
    const fake = makeFakeStore({
      tagRules: [{ firmId: FIRM_X, tagName: "Smith Law" }],
      companyRules: [{ firmId: FIRM_Y, callrailCompanyId: "COM1" }],
    });
    const r = recordingDeps(fake.store, (company) =>
      company === "COM1" ? [CALL({ tags: ["Signed", "Smith Law"] })] : [],
    );
    await syncLeadsForMonth(r.deps, { scope: "mapped", triggeredBy: "scheduled" });
    const stored = [...fake.rows.values()];
    expect(stored).toHaveLength(1);
    expect(stored[0].firmId).toBe(FIRM_X); // the tag's firm…
    expect(stored.some((row) => row.firmId === FIRM_Y)).toBe(false); // …and not the company's
  });

  it("mapped: an untagged lead on a mapped company routes to the company's firm", async () => {
    const fake = makeFakeStore({ companyRules: [{ firmId: FIRM_Y, callrailCompanyId: "COM1" }] });
    const r = recordingDeps(fake.store, (company) => (company === "COM1" ? [CALL({ tags: ["Signed"] })] : []));
    await syncLeadsForMonth(r.deps, { scope: "mapped" });
    expect([...fake.rows.values()].map((row) => row.firmId)).toEqual([FIRM_Y]);
  });

  it("all (the default for a manual run): lists and fetches every company", async () => {
    const fake = makeFakeStore({ companyRules: [{ firmId: FIRM_X, callrailCompanyId: "COM1" }] });
    const r = recordingDeps(fake.store);
    const result = await syncLeadsForMonth(r.deps, {});
    expect(result.scope).toBe("all");
    expect(result.companies).toBe(4);
    expect(r.listed()).toBe(1);
    expect(r.fetched.filter((f) => f.startsWith("calls:"))).toHaveLength(4);
  });

  it("explicit companyIds still win over scope", async () => {
    const fake = makeFakeStore({ companyRules: [{ firmId: FIRM_X, callrailCompanyId: "COM1" }] });
    const r = recordingDeps(fake.store);
    const result = await syncLeadsForMonth(r.deps, { scope: "mapped", companyIds: ["UNSERVED1"] });
    expect(result.scope).toBe("explicit");
    expect([...new Set(r.fetched)]).toEqual(["calls:UNSERVED1", "forms:UNSERVED1"]);
  });
});

// ---------------------------------------------------------------------------
// Run safety: the fetch budget and the stale-job cleanup
// ---------------------------------------------------------------------------

describe("syncLeadsForMonth — fetch budget", () => {
  /** A clock that each company fetch advances by `perCompanyMs`. */
  function timedDeps(store: LeadStore, perCompanyMs: number, companies: string[], records: (c: string) => unknown[] = () => []) {
    let t = Date.UTC(2026, 9, 14, 8, 30);
    const fetchedCalls: string[] = [];
    const fetchedForms: string[] = [];
    const deps = makeDeps(store, {
      now: () => new Date(t),
      listCompanyIds: async () => companies,
      fetchCalls: async (companyId) => {
        fetchedCalls.push(companyId);
        t += perCompanyMs;
        return records(companyId) as never;
      },
      fetchForms: async (companyId) => {
        fetchedForms.push(companyId);
        t += perCompanyMs;
        return [];
      },
    });
    return { deps, fetchedCalls, fetchedForms };
  }

  const COMPANIES = Array.from({ length: 10 }, (_, i) => `COM${i + 1}`);

  it("defaults to 220s", () => {
    expect(FETCH_BUDGET_MS).toBe(220_000);
  });

  it("stops starting new companies once the budget is spent, writes what it fetched, and finishes the job row as failed", async () => {
    const fake = makeFakeStore({ companyRules: COMPANIES.map((c) => ({ firmId: "firm-a", callrailCompanyId: c })) });
    // 30s per company: COM1..COM8 start before 220s (0,30,…,210s); COM9 would start at 240s.
    const t = timedDeps(fake.store, 30_000, COMPANIES, (c) =>
      c === "COM1" ? [CALL({ id: "c-early", tags: ["Signed"] })] : [],
    );
    const r = await syncLeadsForMonth(t.deps, { scope: "mapped", triggeredBy: "scheduled" });

    // Mapped companies are fetched in sorted order; the first 8 of that order fit.
    expect(t.fetchedCalls).toEqual([...COMPANIES].sort().slice(0, 8));
    expect(r.calls.stoppedEarly).toEqual({ phase: "current", afterCompanies: 8, of: 10 });
    expect(r.calls.written).toBe(1); // COM1's lead is still written
    expect([...fake.rows.values()].map((row) => row.callrailId)).toEqual(["c-early"]);

    const callsJob = fake.jobs.find((j) => j.kind === "callrail_calls")!;
    expect(callsJob.status).toBe("failed");
    expect(callsJob.errorMessage).toBe("stopped after 8 of 10 companies (fetch budget 220s)");

    // The budget is shared: forms start after it is spent, so they fetch nothing — and still finish their row.
    expect(t.fetchedForms).toEqual([]);
    const formsJob = fake.jobs.find((j) => j.kind === "callrail_forms")!;
    expect(formsJob.status).toBe("failed");
    expect(formsJob.errorMessage).toBe("stopped after 0 of 10 companies (fetch budget 220s)");
    expect(fake.jobs.some((j) => j.status === "running")).toBe(false);
  });

  it("a run that fits finishes completed, with no stop recorded", async () => {
    const fake = makeFakeStore();
    const t = timedDeps(fake.store, 1_000, COMPANIES);
    const r = await syncLeadsForMonth(t.deps, {});
    expect(r.calls.stoppedEarly).toBeNull();
    expect(r.forms.stoppedEarly).toBeNull();
    expect(fake.jobs.map((j) => j.status)).toEqual(["completed", "completed"]);
  });

  it("the previous-month recheck also respects the budget, and says so", async () => {
    const fake = makeFakeStore({ pending: { call: ["c-old"] } });
    const t = timedDeps(fake.store, 20_000, COMPANIES.slice(0, 6));
    // Current month: 6 × 20s = 120s. Recheck: starts at 120,140,160,180,200 → 5 fit; the 6th would start at 220s.
    const r = await syncLeadsForMonth(t.deps, { fetchBudgetMs: 220_000 });
    expect(r.calls.stoppedEarly).toEqual({ phase: "previous", afterCompanies: 5, of: 6 });
    expect(fake.jobs.find((j) => j.kind === "callrail_calls")!.errorMessage).toBe(
      "stopped after 6 of 6 companies; previous-month recheck stopped after 5 of 6 (fetch budget 220s)",
    );
  });

  it("a dry run stops the same way but writes no job rows", async () => {
    const fake = makeFakeStore();
    const t = timedDeps(fake.store, 30_000, COMPANIES);
    const r = await syncLeadsForMonth(t.deps, { dryRun: true });
    expect(r.calls.stoppedEarly).toEqual({ phase: "current", afterCompanies: 8, of: 10 });
    expect(fake.jobs).toEqual([]);
  });
});

describe("syncLeadsForMonth — stale job cleanup", () => {
  const RUN_AT = new Date("2026-10-14T08:30:00Z");
  const minutesAgo = (m: number) => new Date(RUN_AT.getTime() - m * 60_000);

  it(`marks jobs still 'running' after ${STALE_JOB_MINUTES} minutes as failed, before the run starts its own`, async () => {
    const fake = makeFakeStore({
      seedJobs: [
        { kind: "callrail_calls", status: "running", startedAt: minutesAgo(24 * 60) }, // yesterday's, killed
        { kind: "callrail_forms", status: "running", startedAt: minutesAgo(STALE_JOB_MINUTES + 1) },
        { kind: "callrail_calls", status: "running", startedAt: minutesAgo(5) }, // a run that may still be alive
        { kind: "callrail_calls", status: "completed", startedAt: minutesAgo(60) },
      ],
    });
    const r = await syncLeadsForMonth(makeDeps(fake.store, { now: () => RUN_AT }), { triggeredBy: "scheduled" });
    expect(r.staleJobsFailed).toBe(2);
    expect(fake.jobs.slice(0, 4).map((j) => [j.status, j.errorMessage])).toEqual([
      ["failed", STALE_JOB_MESSAGE],
      ["failed", STALE_JOB_MESSAGE],
      ["running", null],
      ["completed", null],
    ]);
    expect(STALE_JOB_MESSAGE).toBe("No finish recorded (likely stopped at the 300s time limit)");
  });

  it("uses only 'failed' — never a new status value", async () => {
    const fake = makeFakeStore({ seedJobs: [{ kind: "callrail_calls", status: "running", startedAt: minutesAgo(60) }] });
    await syncLeadsForMonth(makeDeps(fake.store, { now: () => RUN_AT }), {});
    expect(new Set(fake.jobs.map((j) => j.status))).toEqual(new Set(["failed", "completed"]));
  });

  it("a dry run does not touch job rows", async () => {
    const fake = makeFakeStore({ seedJobs: [{ kind: "callrail_calls", status: "running", startedAt: minutesAgo(60) }] });
    const r = await syncLeadsForMonth(makeDeps(fake.store, { now: () => RUN_AT }), { dryRun: true });
    expect(r.staleJobsFailed).toBeNull();
    expect(fake.jobs[0].status).toBe("running");
  });

  it("a failing cleanup never stops the sync", async () => {
    const fake = makeFakeStore();
    const store = { ...fake.store, failStaleJobs: async () => { throw new Error("db down"); } };
    const r = await syncLeadsForMonth(makeDeps(store, { now: () => RUN_AT, fetchCalls: async () => [CALL() as never] }), {});
    expect(r.staleJobsFailed).toBeNull();
    expect(r.calls.error).toBeNull();
    expect(r.calls.written).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Month-end: the new-lead window reaches back to the last completed run
// ---------------------------------------------------------------------------

describe("newLeadWindowStart", () => {
  const NOV = { currentFrom: "2026-11-01", previousFrom: "2026-10-01" };
  it.each([
    ["no completed run yet", null, "2026-11-01"],
    ["last run earlier this month", "2026-11-01", "2026-11-01"],
    ["last run on the old month's final day", "2026-10-31", "2026-10-31"],
    ["runs skipped or stopped early since the 28th", "2026-10-28", "2026-10-28"],
    ["a long outage: bounded to the previous month's start", "2026-08-20", "2026-10-01"],
    ["exactly the previous month's start", "2026-10-01", "2026-10-01"],
  ])("%s → %s", (_, last, expected) => {
    expect(newLeadWindowStart(NOV, last)).toBe(expected);
  });

  it("mid-month, a run last night changes nothing: the window is still the 1st", () => {
    expect(newLeadWindowStart({ currentFrom: "2026-10-01", previousFrom: "2026-09-01" }, "2026-10-13")).toBe("2026-10-01");
  });
});

describe("syncLeadsForMonth — month-end", () => {
  // Nov 1, 04:30 Eastern: the first run of November.
  const FIRST_OF_NOVEMBER = new Date("2026-11-01T08:30:00Z");
  // Called Oct 31 at 22:30 Eastern — after Oct 31's 04:30 run.
  const LATE_OCTOBER_CALL = CALL({
    id: "c-oct31-late",
    start_time: "2026-10-31T22:30:00.000-04:00",
    tags: ["Opportunity"],
    note: "Jane Doe, 555-123-4567",
  });

  function monthEndDeps(store: LeadStore) {
    const windows: string[] = [];
    const deps = makeDeps(store, {
      now: () => FIRST_OF_NOVEMBER,
      fetchCalls: async (_company, from, to) => {
        windows.push(`${from}..${to}`);
        // CallRail filters by the call's date: Oct 31 is only returned if the window includes it.
        return (from <= "2026-10-31" && to >= "2026-10-31" ? [LATE_OCTOBER_CALL] : []) as never;
      },
    });
    return { deps, windows };
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIRST_OF_NOVEMBER);
  });

  it("a lead from the last hours of October is ingested on November 1st and lands under last month", async () => {
    const fake = makeFakeStore({
      companyRules: [{ firmId: "firm-a", callrailCompanyId: "COM1" }],
      lastCompleted: { callrail_calls: "2026-10-31", callrail_forms: "2026-10-31" },
    });
    const m = monthEndDeps(fake.store);
    const r = await syncLeadsForMonth(m.deps, { scope: "mapped", triggeredBy: "scheduled" });

    expect(r.calls.fetchedFrom).toBe("2026-10-31");
    expect(m.windows[0]).toBe("2026-10-31..2026-11-01");
    const [row] = [...fake.rows.values()];
    expect(row.callrailId).toBe("c-oct31-late");
    expect(row.firmId).toBe("firm-a");
    expect(toIsoDateEastern(row.occurredAt)).toBe("2026-10-31");

    // The portal's month rule: a non-signed lead belongs to the month of its call.
    const anchor = monthAnchor({ effectiveStatus: row.statusParsed, signedAt: row.signedAt, occurredAt: row.occurredAt });
    expect(inRange(anchor, presetRange("previous"))).toBe(true); // October 2026
    expect(inRange(anchor, presetRange("current"))).toBe(false);
  });

  it("before the fix (no reach-back), the same lead was never fetched", async () => {
    const fake = makeFakeStore({ companyRules: [{ firmId: "firm-a", callrailCompanyId: "COM1" }] });
    const m = monthEndDeps(fake.store);
    await syncLeadsForMonth(m.deps, { scope: "mapped" });
    expect(m.windows[0]).toBe("2026-11-01..2026-11-01");
    expect(fake.rows.size).toBe(0);
  });

  it("a lead seen by both the reach-back and the previous-month recheck is written once", async () => {
    const fake = makeFakeStore({
      companyRules: [{ firmId: "firm-a", callrailCompanyId: "COM1" }],
      lastCompleted: { callrail_calls: "2026-10-31" },
      pending: { call: ["c-oct31-late"] },
    });
    const m = monthEndDeps(fake.store);
    const r = await syncLeadsForMonth(m.deps, { scope: "mapped" });
    expect(m.windows).toContain("2026-10-01..2026-10-31"); // the recheck ran
    expect(r.calls.recheckedFromPreviousMonth).toBe(0); // …and skipped the lead already collected
    expect(r.calls.planned).toBe(1);
    expect(fake.rows.size).toBe(1);
  });

  it("if the last-run lookup fails, the run falls back to the 1st and still runs", async () => {
    const fake = makeFakeStore({ companyRules: [{ firmId: "firm-a", callrailCompanyId: "COM1" }] });
    const store = { ...fake.store, lastCompletedJobToDate: async () => { throw new Error("db down"); } };
    const m = monthEndDeps(store);
    const r = await syncLeadsForMonth(m.deps, { scope: "mapped" });
    expect(r.calls.fetchedFrom).toBe("2026-11-01");
    expect(r.calls.error).toBeNull();
  });

  it("a dry run uses the same reach-back window", async () => {
    const fake = makeFakeStore({
      companyRules: [{ firmId: "firm-a", callrailCompanyId: "COM1" }],
      lastCompleted: { callrail_calls: "2026-10-31" },
    });
    const m = monthEndDeps(fake.store);
    const r = await syncLeadsForMonth(m.deps, { scope: "mapped", dryRun: true });
    expect(r.calls.fetchedFrom).toBe("2026-10-31");
    expect(fake.rows.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Only scheduled runs set the reach-back window
// ---------------------------------------------------------------------------

describe("syncLeadsForMonth — reach-back counts scheduled runs only", () => {
  const LATE_OCTOBER_CALL = CALL({
    id: "c-oct31-late",
    start_time: "2026-10-31T22:30:00.000-04:00",
    tags: ["Opportunity"],
    note: "Jane Doe, 555-123-4567",
  });

  /** One store, three runs at three moments, recording each run's fetch window for COM1 and COM2. */
  async function runAt(
    fake: ReturnType<typeof makeFakeStore>,
    at: string,
    options: Parameters<typeof syncLeadsForMonth>[1],
  ) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(at));
    const windows: string[] = [];
    const deps = makeDeps(fake.store, {
      now: () => new Date(at),
      listCompanyIds: async () => ["COM1", "COM2"],
      fetchCalls: async (company, from, to) => {
        windows.push(`${company} ${from}..${to}`);
        return (company === "COM2" && from <= "2026-10-31" && to >= "2026-10-31" ? [LATE_OCTOBER_CALL] : []) as never;
      },
    });
    const result = await syncLeadsForMonth(deps, options);
    return { result, windows: windows.filter((w) => !w.includes("2026-10-01..2026-10-31")) };
  }

  const companyRules = [
    { firmId: "firm-a", callrailCompanyId: "COM1" },
    { firmId: "firm-b", callrailCompanyId: "COM2" },
  ];

  it("a manual per-firm sync between two scheduled runs does not make the next scheduled run skip a day", async () => {
    const fake = makeFakeStore({ companyRules });

    // 1. Scheduled run, Oct 31 04:30 ET.
    await runAt(fake, "2026-10-31T08:30:00Z", { scope: "mapped", triggeredBy: "scheduled" });
    // 2. A per-firm "Sync now" for firm A only (COM1), Nov 1 00:30 ET — completes, as manual.
    const manual = await runAt(fake, "2026-11-01T04:30:00Z", { companyIds: ["COM1"], triggeredBy: "manual" });
    expect(manual.result.calls.error).toBeNull();
    expect(fake.jobs.filter((j) => j.triggeredBy === "manual").every((j) => j.status === "completed")).toBe(true);
    // 3. The next scheduled run, Nov 1 04:30 ET.
    const next = await runAt(fake, "2026-11-01T08:30:00Z", { scope: "mapped", triggeredBy: "scheduled" });

    // It reaches back to the last SCHEDULED run (Oct 31), not the manual one (Nov 1)…
    expect(next.result.calls.fetchedFrom).toBe("2026-10-31");
    expect(next.windows).toEqual(["COM1 2026-10-31..2026-11-01", "COM2 2026-10-31..2026-11-01"]);
    // …so firm B's late-October lead, on a company the manual run never touched, is caught.
    expect([...fake.rows.values()].map((r) => [r.callrailId, r.firmId])).toEqual([["c-oct31-late", "firm-b"]]);
  });

  it("had the manual run counted, the same lead would have been missed (the bug this prevents)", async () => {
    const fake = makeFakeStore({ companyRules, lastCompleted: { callrail_calls: "2026-11-01" } });
    const next = await runAt(fake, "2026-11-01T08:30:00Z", { scope: "mapped", triggeredBy: "scheduled" });
    expect(next.result.calls.fetchedFrom).toBe("2026-11-01");
    expect(fake.rows.size).toBe(0);
  });

  it("a failed scheduled run does not count either; the newest completed scheduled one does", async () => {
    const fake = makeFakeStore({ companyRules });
    await runAt(fake, "2026-10-30T08:30:00Z", { scope: "mapped", triggeredBy: "scheduled" });
    // Oct 31's scheduled run fails outright.
    fake.jobs.push({ kind: "callrail_calls", status: "failed", triggeredBy: "scheduled", errorMessage: "x", leadsIngested: 0, toDate: "2026-10-31", finishedSeq: 99 });
    const next = await runAt(fake, "2026-11-01T08:30:00Z", { scope: "mapped", triggeredBy: "scheduled" });
    expect(next.result.calls.fetchedFrom).toBe("2026-10-30");
  });

  it("dry runs never count (they write no job rows)", async () => {
    const fake = makeFakeStore({ companyRules });
    await runAt(fake, "2026-10-31T08:30:00Z", { scope: "mapped", triggeredBy: "scheduled" });
    await runAt(fake, "2026-11-01T04:30:00Z", { scope: "mapped", dryRun: true });
    const next = await runAt(fake, "2026-11-01T08:30:00Z", { scope: "mapped", triggeredBy: "scheduled" });
    expect(next.result.calls.fetchedFrom).toBe("2026-10-31");
  });
});

// ---------------------------------------------------------------------------
// Text conversations: an opt-in third pass
// ---------------------------------------------------------------------------

describe("syncLeadsForMonth — texts", () => {
  type Thread = Parameters<NonNullable<SyncDeps["fetchTexts"]>>[0] extends string ? import("./callrail-client").TrackerTextThread : never;
  const thread = (over: Partial<Thread> = {}): Thread => ({
    id: "CON1:11",
    conversationId: "CON1",
    threadId: "11",
    customer_name: "Fallback Name",
    customer_phone_number: "555-000-1111",
    tracker_name: "Texts",
    initial_tracker_id: null,
    first_message_at: "2026-10-05T14:30:00.000-04:00",
    tags: ["Signed"],
    note: "Jane Doe, 555-123-4567",
    ...over,
  });
  const textDeps = (store: LeadStore, threads: Thread[] | ((c: string) => Thread[]), over: Partial<SyncDeps> = {}) => {
    const asked: string[] = [];
    const deps = makeDeps(store, {
      now: () => NOW,
      fetchTexts: async (companyId) => {
        asked.push(companyId);
        return typeof threads === "function" ? threads(companyId) : threads;
      },
      ...over,
    });
    return { deps, asked };
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  it("is OFF unless asked for: texts never fetched, result.texts null", async () => {
    const fake = makeFakeStore({ companyRules: [{ firmId: "firm-a", callrailCompanyId: "COM1" }] });
    const t = textDeps(fake.store, [thread()]);
    const r = await syncLeadsForMonth(t.deps, { scope: "mapped" });
    expect(t.asked).toEqual([]);
    expect(r.texts).toBeNull();
    expect(fake.jobs.map((j) => j.kind)).toEqual(["callrail_calls", "callrail_forms"]);
  });

  it("with includeTexts: a text lead, its own job row, routed by company", async () => {
    const fake = makeFakeStore({ companyRules: [{ firmId: "firm-a", callrailCompanyId: "COM1" }] });
    const t = textDeps(fake.store, [thread()]);
    const r = await syncLeadsForMonth(t.deps, { scope: "mapped", includeTexts: true, triggeredBy: "manual" });
    expect(t.asked).toEqual(["COM1"]);
    expect(r.texts).toMatchObject({ fetched: 1, planned: 1, assigned: 1, unassigned: 0, written: 1, error: null });
    const [row] = [...fake.rows.values()];
    expect(row).toMatchObject({ source: "text", callrailId: "CON1:11", personSuffix: "p1", firmId: "firm-a", statusParsed: "signed" });
    expect(row.occurredAt.toISOString()).toBe("2026-10-05T18:30:00.000Z");
    expect(fake.jobs.map((j) => [j.kind, j.status])).toContainEqual(["callrail_texts", "completed"]);
  });

  it("routes by firm tag first, like calls", async () => {
    const fake = makeFakeStore({
      tagRules: [{ firmId: "firm-x", tagName: "Smith Law" }],
      companyRules: [{ firmId: "firm-y", callrailCompanyId: "COM1" }],
    });
    const t = textDeps(fake.store, [thread({ tags: ["Signed", "Smith Law"] })]);
    await syncLeadsForMonth(t.deps, { scope: "mapped", includeTexts: true });
    expect([...fake.rows.values()].map((r) => r.firmId)).toEqual(["firm-x"]);
  });

  it("a multi-person note in a text gives p1/p2, each with their own status", async () => {
    const fake = makeFakeStore({ companyRules: [{ firmId: "firm-a", callrailCompanyId: "COM1" }] });
    const t = textDeps(fake.store, [
      thread({ tags: ["2 Person", "Pending"], note: "Jane Doe, 555-111-2222, Signed; John Roe, 555-333-4444, Pending" }),
    ]);
    await syncLeadsForMonth(t.deps, { scope: "mapped", includeTexts: true });
    const rows = [...fake.rows.values()].sort((a, b) => a.personSuffix.localeCompare(b.personSuffix));
    expect(rows.map((r) => [r.callrailId, r.personSuffix, r.statusParsed])).toEqual([
      ["CON1:11", "p1", "signed"],
      ["CON1:11", "p2", "pending"],
    ]);
  });

  it("two threads of one conversation are two leads", async () => {
    const fake = makeFakeStore({ companyRules: [{ firmId: "firm-a", callrailCompanyId: "COM1" }] });
    const t = textDeps(fake.store, [
      thread(),
      thread({ id: "CON1:12", threadId: "12", tags: ["Pending"], note: "Ann Poe, 555-555-6666", first_message_at: "2026-10-09T10:00:00.000-04:00" }),
    ]);
    await syncLeadsForMonth(t.deps, { scope: "mapped", includeTexts: true });
    expect([...fake.rows.values()].map((r) => r.callrailId).sort()).toEqual(["CON1:11", "CON1:12"]);
  });

  it("a dry run reports text counts — fetched, planned, parse failures, assigned vs unassigned — and writes nothing", async () => {
    const fake = makeFakeStore({ companyRules: [{ firmId: "firm-a", callrailCompanyId: "COM1" }] });
    const t = textDeps(fake.store, [
      thread(),
      thread({ id: "CON2:21", conversationId: "CON2", threadId: "21", note: "Jane 555-111-2222 John 555-333-4444" }),
    ]);
    const r = await syncLeadsForMonth(t.deps, { scope: "mapped", includeTexts: true, dryRun: true });
    expect(r.texts).toMatchObject({ fetched: 2, planned: 2, parseFailed: 1, assigned: 2, unassigned: 0, written: 0 });
    expect(r.texts?.parseFailureReasons).toEqual({ multiple_phone_numbers: 1 });
    expect(fake.rows.size).toBe(0);
    expect(fake.jobs).toEqual([]);
  });

  it("shares the fetch budget: a run out of time stops texts and finishes their job as failed", async () => {
    let t = NOW.getTime();
    const fake = makeFakeStore({ companyRules: ["COM1", "COM2", "COM3"].map((c) => ({ firmId: "firm-a", callrailCompanyId: c })) });
    const deps = makeDeps(fake.store, {
      now: () => new Date(t),
      fetchCalls: async () => {
        t += 72_000; // calls use 216s of the 220s budget over three companies
        return [];
      },
      fetchForms: async () => [],
      fetchTexts: async () => {
        t += 5_000; // the first text company starts at 216s and ends past 220s
        return [thread()];
      },
    });
    const r = await syncLeadsForMonth(deps, { scope: "mapped", includeTexts: true });
    expect(r.texts?.stoppedEarly).toEqual({ phase: "current", afterCompanies: 1, of: 3 });
    const job = fake.jobs.find((j) => j.kind === "callrail_texts")!;
    expect(job.status).toBe("failed");
    expect(job.errorMessage).toBe("stopped after 1 of 3 companies (fetch budget 220s)");
  });

  it("asked for texts without a fetcher: reported, never fatal to calls and forms", async () => {
    const fake = makeFakeStore();
    const r = await syncLeadsForMonth(makeDeps(fake.store, { now: () => NOW }), { includeTexts: true });
    expect(r.texts?.error).toMatch(/no text fetcher/);
    expect(r.calls.error).toBeNull();
  });
});
