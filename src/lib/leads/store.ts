// The ONLY file in the lead tracker's ingestion path that touches the
// database. sync.ts takes a LeadStore and never imports the db client, so
// the orchestration can be exercised end to end against a fake.

import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/lib/db/client";
import {
  leadFirmCallrailCompanies,
  leadFirmTags,
  leadFirms,
  leadNotes,
  leadSyncJobs,
  leads,
} from "@/lib/db/schema";
import { easternWallClockToDate } from "@/lib/date-utils";
import type { ExistingLeadRow } from "./reconcile";
import {
  leadKey,
  type JobKind,
  type LeadSource,
  type LeadStore,
  type PlannedLead,
} from "./types";

// Postgres has a parameter ceiling per statement and these rows are wide,
// so writes go in chunks rather than one enormous insert.
const WRITE_CHUNK = 200;

// Lead GROUPS per transaction, not rows: a group is one person on one
// CallRail record and may span several firms, and its repoint and upsert
// must never be split across two transactions.
const GROUP_CHUNK = 100;

/**
 * The drizzle instance. Taken as a parameter by every builder below so the
 * query-compilation test can pass a connectionless instance and assert on
 * the SQL and parameters the REAL code produces — the store being injected
 * meant Drizzle itself was never exercised, which is how a parameter-binding
 * bug reached production with 606 tests green.
 */
export type LeadDb = Pick<
  typeof db,
  "insert" | "update" | "delete" | "select" | "selectDistinct"
>;

// Calendar arithmetic on an abstract date, assembled field by field rather
// than via toISOString().slice(0, 10) — that call reads a UTC calendar date
// off an instant, which is the bug class this whole codebase keeps hitting.
function nextIsoDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return [
    dt.getUTCFullYear(),
    String(dt.getUTCMonth() + 1).padStart(2, "0"),
    String(dt.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * An Eastern calendar day range as a half-open instant range. Half-open
 * because a closed range ending at 23:59:59 silently drops anything in that
 * final second, and because the exclusive bound is DST-safe where adding
 * 24 hours to a start instant is not.
 */
export function easternDayRangeToInstants(
  fromIsoEastern: string,
  toIsoEastern: string,
): { start: Date; endExclusive: Date } {
  const start = easternWallClockToDate(`${fromIsoEastern} 00:00:00`);
  const endExclusive = easternWallClockToDate(`${nextIsoDate(toIsoEastern)} 00:00:00`);
  if (!start || !endExclusive) {
    throw new Error(
      `Invalid Eastern date range: ${fromIsoEastern}..${toIsoEastern}`,
    );
  }
  return { start, endExclusive };
}

/**
 * Binds a Date for use INSIDE a raw `sql` template.
 *
 * This is the fix for a real failure: every write threw "The \"string\"
 * argument must be of type string or an instance of Buffer or ArrayBuffer.
 * Received an instance of Date". A Date assigned to a typed column is safe —
 * Drizzle wraps it in a Param carrying that column as its encoder, which
 * converts it before the driver sees it. A Date interpolated into a raw
 * template carries NO encoder, so the Date object itself reaches
 * postgres.js, which calls Buffer.byteLength on it and throws.
 *
 * Passing the column makes this serialise through the exact same encoder the
 * typed path uses, so the two can never diverge. store-queries.test.ts
 * compiles every real query here and fails if any parameter is still a Date.
 */
function dateParam(value: Date, column: PgColumn) {
  return sql.param(value, column);
}

// The effective status: an admin override wins, otherwise what the sync
// parsed. Mirrors the coalesce(override, parsed) rule the read path uses.
const effectiveStatus = sql`coalesce(${leads.statusOverride}, ${leads.statusParsed})`;

export function buildTagRulesQuery(database: LeadDb) {
  return database
    .select({ firmId: leadFirmTags.firmId, tagName: leadFirmTags.tagName })
    .from(leadFirmTags)
    .innerJoin(leadFirms, eq(leadFirms.id, leadFirmTags.firmId))
    .where(eq(leadFirms.isActive, true));
}

export function buildCompanyRulesQuery(database: LeadDb) {
  return database
    .select({
      firmId: leadFirmCallrailCompanies.firmId,
      callrailCompanyId: leadFirmCallrailCompanies.callrailCompanyId,
    })
    .from(leadFirmCallrailCompanies)
    .innerJoin(leadFirms, eq(leadFirms.id, leadFirmCallrailCompanies.firmId))
    .where(eq(leadFirms.isActive, true));
}

export function buildPendingCallrailIdsQuery(
  database: LeadDb,
  fromIsoEastern: string,
  toIsoEastern: string,
  source: LeadSource,
) {
  const { start, endExclusive } = easternDayRangeToInstants(
    fromIsoEastern,
    toIsoEastern,
  );
  return database
    .selectDistinct({ callrailId: leads.callrailId })
    .from(leads)
    .where(
      and(
        eq(leads.source, source),
        gte(leads.occurredAt, start),
        lt(leads.occurredAt, endExclusive),
        sql`${effectiveStatus} = 'pending'`,
      ),
    );
}

export function buildExistingLeadRowsQuery(
  database: LeadDb,
  callrailIds: readonly string[],
) {
  return database
    .select({
      id: leads.id,
      firmId: leads.firmId,
      callrailId: leads.callrailId,
      personSuffix: leads.personSuffix,
      // Whether a human has touched this row. Decides, for a row whose firm
      // no longer matches routing, between deleting it and keeping it
      // flagged — see reconcileLeadRows.
      hasOverrides: sql<boolean>`(
        ${leads.nameOverride} is not null
        or ${leads.phoneOverride} is not null
        or ${leads.statusOverride} is not null
        or ${leads.isOpportunityOverride} is not null
      )`,
      hasNotes: sql<boolean>`exists (
        select 1 from ${leadNotes} where ${leadNotes.leadId} = ${leads.id}
      )`,
    })
    .from(leads)
    .where(inArray(leads.callrailId, [...callrailIds]));
}

export function buildRepointUpdate(
  database: LeadDb,
  rowId: string,
  toFirmId: string | null,
  now: Date,
) {
  return database
    .update(leads)
    .set({ firmId: toFirmId, needsReview: toFirmId === null, updatedAt: now })
    .where(eq(leads.id, rowId));
}

export function buildFlagStaleUpdate(
  database: LeadDb,
  rowIds: readonly string[],
  now: Date,
) {
  // Kept, not deleted: needs_review removes it from client visibility while
  // leaving it in the admin queue, so nothing a human wrote is destroyed.
  return database
    .update(leads)
    .set({ needsReview: true, updatedAt: now })
    .where(inArray(leads.id, [...rowIds]));
}

export function buildDeleteRows(database: LeadDb, rowIds: readonly string[]) {
  return database.delete(leads).where(inArray(leads.id, [...rowIds]));
}

export function buildFirmPhoneIndexQuery(
  database: LeadDb,
  firmIds: readonly string[],
) {
  return database
    .select({
      leadId: leads.id,
      firmId: leads.firmId,
      callrailId: leads.callrailId,
      // The EFFECTIVE phone: an admin correction is what should be compared,
      // not whatever the note happened to say.
      phone: sql<string | null>`coalesce(${leads.phoneOverride}, ${leads.phoneParsed})`,
    })
    .from(leads)
    .where(inArray(leads.firmId, [...firmIds]));
}

export function buildStartJobInsert(
  database: LeadDb,
  input: { kind: JobKind; triggeredBy: string; fromDate: string; toDate: string; startedAt: Date },
) {
  return database
    .insert(leadSyncJobs)
    .values({
      kind: input.kind,
      status: "running",
      startedAt: input.startedAt,
      triggeredBy: input.triggeredBy,
      fromDate: input.fromDate,
      toDate: input.toDate,
    })
    .returning();
}

export function buildFinishJobUpdate(
  database: LeadDb,
  input: {
    jobId: string;
    status: "completed" | "failed";
    errorMessage: string | null;
    leadsIngested: number;
    completedAt: Date;
  },
) {
  return database
    .update(leadSyncJobs)
    .set({
      status: input.status,
      completedAt: input.completedAt,
      errorMessage: input.errorMessage?.slice(0, 2000) ?? null,
      leadsIngested: input.leadsIngested,
    })
    .where(eq(leadSyncJobs.id, input.jobId));
}

export const drizzleLeadStore: LeadStore = {
  async loadRoutingRules() {
    const [tagRows, companyRows] = await Promise.all([
      buildTagRulesQuery(db),
      buildCompanyRulesQuery(db),
    ]);
    // Inactive firms are excluded on purpose: deactivating a firm must stop
    // new leads being routed to it, and the alternative (routing then
    // hiding) leaves its data growing behind a flag.
    return { tagRules: tagRows, companyRules: companyRows };
  },

  async findPendingCallrailIds(fromIsoEastern, toIsoEastern, source: LeadSource) {
    const rows = await buildPendingCallrailIdsQuery(
      db,
      fromIsoEastern,
      toIsoEastern,
      source,
    );
    return new Set(rows.map((r) => r.callrailId));
  },

  async findExistingLeadRows(callrailIds) {
    if (callrailIds.length === 0) return [];
    const out: ExistingLeadRow[] = [];
    for (let i = 0; i < callrailIds.length; i += WRITE_CHUNK) {
      const chunk = callrailIds.slice(i, i + WRITE_CHUNK);
      const rows = await buildExistingLeadRowsQuery(db, chunk);
      for (const r of rows) {
        out.push({
          id: r.id,
          firmId: r.firmId,
          callrailId: r.callrailId,
          personSuffix: r.personSuffix,
          hasOverrides: !!r.hasOverrides,
          hasNotes: !!r.hasNotes,
        });
      }
    }
    return out;
  },

  async findFirmPhoneIndex(firmIds) {
    if (firmIds.length === 0) return [];
    const rows = await buildFirmPhoneIndexQuery(db, firmIds);
    return rows
      .filter((r): r is typeof r & { firmId: string } => r.firmId !== null)
      .map((r) => ({
        leadId: r.leadId,
        firmId: r.firmId,
        callrailId: r.callrailId,
        phone: r.phone,
      }));
  },

  async applyReconciliation(plan) {
    const now = new Date();
    let written = 0;

    // Chunked BY LEAD GROUP, never mid-group, so a group's repoint and its
    // upsert always land in the same transaction. Splitting them is exactly
    // how a crash leaves the duplicate row this mechanism exists to stop.
    const repointsByKey = new Map<string, typeof plan.repoint>();
    for (const r of plan.repoint) {
      const key = leadKey(r.callrailId, r.personSuffix);
      const list = repointsByKey.get(key) ?? [];
      list.push(r);
      repointsByKey.set(key, list);
    }
    const upsertsByKey = new Map<string, PlannedLead[]>();
    for (const row of plan.upsert) {
      const key = leadKey(row.callrailId, row.personSuffix);
      const list = upsertsByKey.get(key) ?? [];
      list.push(row);
      upsertsByKey.set(key, list);
    }
    const keys = [...new Set([...repointsByKey.keys(), ...upsertsByKey.keys()])];

    for (let i = 0; i < keys.length; i += GROUP_CHUNK) {
      const slice = keys.slice(i, i + GROUP_CHUNK);
      const repoints = slice.flatMap((k) => repointsByKey.get(k) ?? []);
      const upserts = slice.flatMap((k) => upsertsByKey.get(k) ?? []);
      await db.transaction(async (tx) => {
        // Repoints FIRST: each one frees the slot the matching upsert then
        // lands on, turning what would have been an insert into an update
        // of the row that already holds the notes and overrides.
        for (const r of repoints) {
          await buildRepointUpdate(tx, r.rowId, r.toFirmId, now);
        }
        const assigned = upserts.filter((r) => r.firmId !== null);
        const unassigned = upserts.filter((r) => r.firmId === null);
        if (assigned.length > 0) await buildLeadUpsert(tx, assigned, false, now);
        if (unassigned.length > 0) await buildLeadUpsert(tx, unassigned, true, now);
      });
      written += upserts.length;
    }

    // Surplus handling is order-independent: these rows belong to firms that
    // are not targets, so no upsert above could have touched them.
    if (plan.deleteRowIds.length > 0 || plan.flagStaleRowIds.length > 0) {
      await db.transaction(async (tx) => {
        for (let i = 0; i < plan.deleteRowIds.length; i += WRITE_CHUNK) {
          await buildDeleteRows(tx, plan.deleteRowIds.slice(i, i + WRITE_CHUNK));
        }
        for (let i = 0; i < plan.flagStaleRowIds.length; i += WRITE_CHUNK) {
          await buildFlagStaleUpdate(
            tx,
            plan.flagStaleRowIds.slice(i, i + WRITE_CHUNK),
            now,
          );
        }
      });
    }

    return {
      written,
      repointed: plan.repoint.length,
      deleted: plan.deleteRowIds.length,
      flagged: plan.flagStaleRowIds.length,
    };
  },

  async startJob({ kind, triggeredBy, fromDate, toDate }) {
    const [row] = await buildStartJobInsert(db, {
      kind,
      triggeredBy,
      fromDate,
      toDate,
      startedAt: new Date(),
    });
    return row.id;
  },

  async finishJob({ jobId, status, errorMessage, leadsIngested }) {
    await buildFinishJobUpdate(db, {
      jobId,
      status,
      errorMessage,
      leadsIngested,
      completedAt: new Date(),
    });
  },
};

function toInsertValues(r: PlannedLead) {
  return {
    firmId: r.firmId,
    source: r.source,
    callrailId: r.callrailId,
    personSuffix: r.personSuffix,
    callrailCompanyId: r.callrailCompanyId,
    occurredAt: r.occurredAt,
    rawSourceName: r.rawSourceName,
    rawTrackerId: r.rawTrackerId,
    rawNote: r.rawNote,
    rawTags: r.rawTags,
    rawFormData: r.rawFormData,
    customerPhoneCallerid: r.customerPhoneCallerid,
    nameParsed: r.nameParsed,
    phoneParsed: r.phoneParsed,
    statusParsed: r.statusParsed,
    statusTagMatched: r.statusTagMatched,
    isOpportunityParsed: r.isOpportunityParsed,
    suggestedStatus: r.suggestedStatus,
    suggestedStatusSeenAt: r.suggestedStatus ? new Date() : null,
    signedAt: r.signedAt,
    signedAtSource: r.signedAt ? ("sync" as const) : null,
    parseFailed: r.parseFailed,
    parseError: r.parseError,
    needsReview: r.needsReview,
    possibleDuplicateOf: r.possibleDuplicateOf,
  };
}

/**
 * The conflict-update set. Note what is ABSENT and cannot be added by
 * accident, because PlannedLead has no field for it: name_override,
 * phone_override, status_override, is_opportunity_override. first_seen_at is
 * also absent, so it keeps the value from the first time the lead was seen.
 */
function conflictSet(now: Date) {
  return {
    callrailCompanyId: sql`excluded.callrail_company_id`,
    occurredAt: sql`excluded.occurred_at`,
    rawSourceName: sql`excluded.raw_source_name`,
    rawTrackerId: sql`excluded.raw_tracker_id`,
    rawNote: sql`excluded.raw_note`,
    rawTags: sql`excluded.raw_tags`,
    rawFormData: sql`excluded.raw_form_data`,
    customerPhoneCallerid: sql`excluded.customer_phone_callerid`,
    nameParsed: sql`excluded.name_parsed`,
    phoneParsed: sql`excluded.phone_parsed`,
    statusParsed: sql`excluded.status_parsed`,
    statusTagMatched: sql`excluded.status_tag_matched`,
    isOpportunityParsed: sql`excluded.is_opportunity_parsed`,
    suggestedStatus: sql`excluded.suggested_status`,
    // Only re-stamped when the suggestion actually CHANGES, so the admin's
    // "CallRail shows Signed on [date]" keeps saying when CallRail first
    // showed it rather than when the sync last ran.
    suggestedStatusSeenAt: sql`case
      when ${leads.suggestedStatus} is distinct from excluded.suggested_status
        then ${dateParam(now, leads.suggestedStatusSeenAt)}
        else ${leads.suggestedStatusSeenAt}
      end`,
    // Never overwritten once set. The webhook's receipt time is the true
    // sign moment; a later sync's clock is strictly worse information, and
    // this is the whole reason the webhook exists.
    signedAt: sql`coalesce(${leads.signedAt}, excluded.signed_at)`,
    signedAtSource: sql`case
      when ${leads.signedAt} is null and excluded.signed_at is not null
        then 'sync'
        else ${leads.signedAtSource}
      end`,
    parseFailed: sql`excluded.parse_failed`,
    parseError: sql`excluded.parse_error`,
    // Recomputed every run, so clearing it in the admin UI while the
    // underlying cause still holds will see it come back on the next sync.
    // That is the safe direction: the queue reflects the live condition.
    needsReview: sql`excluded.needs_review`,
    // Recomputed each run, like needs_review: the queue reflects the live
    // condition rather than a stale one-time verdict.
    possibleDuplicateOf: sql`excluded.possible_duplicate_of`,
    lastSyncedAt: now,
    updatedAt: now,
  };
}

export function buildLeadUpsert(
  database: LeadDb,
  chunk: readonly PlannedLead[],
  unassigned: boolean,
  now: Date,
) {
  const stmt = database.insert(leads).values(chunk.map(toInsertValues));
  if (unassigned) {
    // Targets leads_unassigned_callrail_person_idx, the PARTIAL unique
    // index. The plain unique constraint does not constrain these rows at
    // all: firm_id is null and Postgres treats NULL as distinct from NULL,
    // so without this predicate every run would insert a fresh duplicate of
    // every admin-queue lead.
    return stmt.onConflictDoUpdate({
      target: [leads.callrailId, leads.personSuffix],
      targetWhere: isNull(leads.firmId),
      set: conflictSet(now),
    });
  }
  return stmt.onConflictDoUpdate({
    target: [leads.firmId, leads.callrailId, leads.personSuffix],
    set: conflictSet(now),
  });
}

