import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { leads } from "@/lib/db/schema";
import {
  buildAssignedFirmIdsQuery,
  buildCompanyRulesQuery,
  buildFinishJobUpdate,
  buildLeadUpsert,
  buildPendingCallrailIdsQuery,
  buildStartJobInsert,
  buildTagRulesQuery,
  type LeadDb,
} from "./store";
import type { PlannedLead } from "./types";

// A connectionless Drizzle instance. toSQL() compiles without ever opening a
// socket, so these exercise the REAL query builders — which is the gap that
// let a parameter-binding bug reach production with the whole suite green:
// the store is injected everywhere else, so Drizzle itself was never run.
const db = drizzle({} as never, { schema }) as LeadDb;

const NOW = new Date("2026-10-14T15:00:00.000Z");

function rawDateParams(q: { params: unknown[] }): unknown[] {
  return q.params.filter((p) => p instanceof Date);
}

/**
 * postgres.js serialises a parameter by writing it into a wire buffer. Only
 * primitives survive that; anything still carrying a class (Date being the
 * one that bit us) throws ERR_INVALID_ARG_TYPE at Buffer.byteLength.
 */
function driverUnsafeParams(q: { params: unknown[] }): unknown[] {
  return q.params.filter((p) => {
    if (p === null || p === undefined) return false;
    const t = typeof p;
    if (t === "string" || t === "number" || t === "boolean" || t === "bigint") {
      return false;
    }
    if (Array.isArray(p)) {
      return p.some((x) => x !== null && typeof x === "object");
    }
    return true;
  });
}

const ROW: PlannedLead = {
  firmId: null,
  source: "call",
  callrailId: "CAL123",
  personSuffix: "p1",
  callrailCompanyId: "COM1",
  occurredAt: NOW,
  rawSourceName: "PPC - Main",
  rawTrackerId: "TRK1",
  rawNote: "Jane Doe, 555-123-4567",
  rawTags: ["Signed", "Opportunity"],
  rawFormData: { full_name: "Jane Doe" },
  customerPhoneCallerid: "555-000-1111",
  nameParsed: "Jane Doe",
  phoneParsed: "555-123-4567",
  statusParsed: "signed",
  statusTagMatched: "Signed",
  isOpportunityParsed: true,
  suggestedStatus: "signed",
  parseFailed: false,
  parseError: null,
  needsReview: false,
  signedAt: NOW,
};

const ASSIGNED: PlannedLead = { ...ROW, firmId: "11111111-1111-1111-1111-111111111111" };

// ---------------------------------------------------------------------------
// The detector has to be able to fail, or the rest of this file proves nothing
// ---------------------------------------------------------------------------

describe("the detector itself", () => {
  it("DOES flag a Date interpolated into a raw sql template", () => {
    const bad = db
      .insert(leads)
      .values([ROW].map(() => ({
        source: "call",
        callrailId: "x",
        callrailCompanyId: "c",
        occurredAt: NOW,
      })))
      .onConflictDoUpdate({
        target: [leads.callrailId],
        // Exactly the construct that broke the live write path.
        set: { lastSyncedAt: sql`${NOW}` },
      })
      .toSQL();
    expect(rawDateParams(bad)).toHaveLength(1);
    expect(driverUnsafeParams(bad)).toHaveLength(1);
  });

  it("does NOT flag a Date assigned to a typed column", () => {
    const good = db
      .insert(leads)
      .values([{ source: "call", callrailId: "x", callrailCompanyId: "c", occurredAt: NOW }])
      .onConflictDoUpdate({ target: [leads.callrailId], set: { lastSyncedAt: NOW } })
      .toSQL();
    expect(rawDateParams(good)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Every query the store actually runs
// ---------------------------------------------------------------------------

const QUERIES: Array<[string, () => { sql: string; params: unknown[] }]> = [
  ["tag rules", () => buildTagRulesQuery(db).toSQL()],
  ["company rules", () => buildCompanyRulesQuery(db).toSQL()],
  [
    "pending callrail ids (previous-month pass)",
    () => buildPendingCallrailIdsQuery(db, "2026-09-01", "2026-09-30", "call").toSQL(),
  ],
  ["assigned firm ids", () => buildAssignedFirmIdsQuery(db, ["CAL1", "CAL2"]).toSQL()],
  [
    "start job",
    () =>
      buildStartJobInsert(db, {
        kind: "callrail_calls",
        triggeredBy: "scheduled",
        fromDate: "2026-10-01",
        toDate: "2026-10-14",
        startedAt: NOW,
      }).toSQL(),
  ],
  [
    "finish job",
    () =>
      buildFinishJobUpdate(db, {
        jobId: "22222222-2222-2222-2222-222222222222",
        status: "completed",
        errorMessage: null,
        leadsIngested: 24,
        completedAt: NOW,
      }).toSQL(),
  ],
  ["upsert — unassigned", () => buildLeadUpsert(db, [ROW], true, NOW).toSQL()],
  ["upsert — assigned", () => buildLeadUpsert(db, [ASSIGNED], false, NOW).toSQL()],
  [
    "upsert — multi-row chunk",
    () =>
      buildLeadUpsert(
        db,
        [ROW, { ...ROW, callrailId: "CAL456", personSuffix: "p2" }, ASSIGNED],
        true,
        NOW,
      ).toSQL(),
  ],
  [
    "upsert — nulls everywhere optional",
    () =>
      buildLeadUpsert(
        db,
        [
          {
            ...ROW,
            rawSourceName: null,
            rawTrackerId: null,
            rawNote: null,
            rawFormData: null,
            customerPhoneCallerid: null,
            nameParsed: null,
            phoneParsed: null,
            statusTagMatched: null,
            signedAt: null,
            parseFailed: true,
            parseError: "empty_note",
            needsReview: true,
          },
        ],
        true,
        NOW,
      ).toSQL(),
  ],
];

describe("every compiled query binds only driver-safe parameters", () => {
  it.each(QUERIES)("%s — no raw Date parameters", (_label, build) => {
    expect(rawDateParams(build())).toEqual([]);
  });

  it.each(QUERIES)("%s — no parameter still carrying a class", (_label, build) => {
    expect(driverUnsafeParams(build())).toEqual([]);
  });

  it.each(QUERIES)("%s — compiles to non-empty SQL", (_label, build) => {
    expect(build().sql.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The specific regression
// ---------------------------------------------------------------------------

describe("the suggested_status_seen_at CASE — the construct that failed live", () => {
  it("still emits the conditional re-stamp", () => {
    const { sql: text } = buildLeadUpsert(db, [ROW], true, NOW).toSQL();
    expect(text).toMatch(/case\s+when/i);
    expect(text).toContain("is distinct from excluded.suggested_status");
  });

  it("binds the timestamp as an ISO string, exactly as a typed column would", () => {
    const { params } = buildLeadUpsert(db, [ROW], true, NOW).toSQL();
    expect(params).toContain(NOW.toISOString());
    expect(params.filter((p) => p === NOW.toISOString()).length).toBeGreaterThan(0);
  });

  it("targets the partial unique index for unassigned rows", () => {
    const { sql: text } = buildLeadUpsert(db, [ROW], true, NOW).toSQL();
    expect(text).toMatch(/on conflict \("callrail_id","person_suffix"\) where/i);
  });

  it("targets the plain unique constraint for assigned rows", () => {
    const { sql: text } = buildLeadUpsert(db, [ASSIGNED], false, NOW).toSQL();
    expect(text).toMatch(/on conflict \("firm_id","callrail_id","person_suffix"\)/i);
    expect(text).not.toMatch(/on conflict \([^)]*\) where/i);
  });

  it("never updates an override column on conflict", () => {
    const { sql: text } = buildLeadUpsert(db, [ROW], true, NOW).toSQL();
    const setClause = text.slice(text.toLowerCase().indexOf("do update set"));
    for (const col of [
      "name_override",
      "phone_override",
      "status_override",
      "is_opportunity_override",
      "first_seen_at",
    ]) {
      expect(setClause).not.toContain(`"${col}" =`);
    }
  });

  it("keeps an existing signed_at with coalesce rather than overwriting it", () => {
    const { sql: text } = buildLeadUpsert(db, [ROW], true, NOW).toSQL();
    expect(text).toContain('coalesce("leads"."signed_at", excluded.signed_at)');
  });
});
