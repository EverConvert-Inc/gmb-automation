// The ONLY file in the lead tracker's ingestion path that touches the
// database. sync.ts takes a LeadStore and never imports the db client, so
// the orchestration can be exercised end to end against a fake.

import { and, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  leadFirmCallrailCompanies,
  leadFirmTags,
  leadFirms,
  leadSyncJobs,
  leads,
} from "@/lib/db/schema";
import { easternWallClockToDate } from "@/lib/date-utils";
import { leadKey, type LeadSource, type LeadStore, type PlannedLead } from "./types";

// Postgres has a parameter ceiling per statement and these rows are wide,
// so writes go in chunks rather than one enormous insert.
const WRITE_CHUNK = 200;

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

// The effective status: an admin override wins, otherwise what the sync
// parsed. Mirrors the coalesce(override, parsed) rule the read path uses.
const effectiveStatus = sql`coalesce(${leads.statusOverride}, ${leads.statusParsed})`;

export const drizzleLeadStore: LeadStore = {
  async loadRoutingRules() {
    const [tagRows, companyRows] = await Promise.all([
      db
        .select({ firmId: leadFirmTags.firmId, tagName: leadFirmTags.tagName })
        .from(leadFirmTags)
        .innerJoin(leadFirms, eq(leadFirms.id, leadFirmTags.firmId))
        .where(eq(leadFirms.isActive, true)),
      db
        .select({
          firmId: leadFirmCallrailCompanies.firmId,
          callrailCompanyId: leadFirmCallrailCompanies.callrailCompanyId,
        })
        .from(leadFirmCallrailCompanies)
        .innerJoin(leadFirms, eq(leadFirms.id, leadFirmCallrailCompanies.firmId))
        .where(eq(leadFirms.isActive, true)),
    ]);
    // Inactive firms are excluded on purpose: deactivating a firm must stop
    // new leads being routed to it, and the alternative (routing then
    // hiding) leaves its data growing behind a flag.
    return { tagRules: tagRows, companyRules: companyRows };
  },

  async findPendingCallrailIds(fromIsoEastern, toIsoEastern, source: LeadSource) {
    const { start, endExclusive } = easternDayRangeToInstants(
      fromIsoEastern,
      toIsoEastern,
    );
    const rows = await db
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
    return new Set(rows.map((r) => r.callrailId));
  },

  async findAssignedFirmIds(callrailIds) {
    if (callrailIds.length === 0) return new Map();
    const out = new Map<string, string[]>();
    for (let i = 0; i < callrailIds.length; i += WRITE_CHUNK) {
      const chunk = callrailIds.slice(i, i + WRITE_CHUNK);
      const rows = await db
        .select({
          callrailId: leads.callrailId,
          personSuffix: leads.personSuffix,
          firmId: leads.firmId,
        })
        .from(leads)
        .where(and(inArray(leads.callrailId, chunk), isNotNull(leads.firmId)));
      for (const r of rows) {
        if (!r.firmId) continue;
        const key = leadKey(r.callrailId, r.personSuffix);
        const list = out.get(key) ?? [];
        if (!list.includes(r.firmId)) list.push(r.firmId);
        out.set(key, list);
      }
    }
    return out;
  },

  async upsertLeads(rows) {
    if (rows.length === 0) return { written: 0 };
    const assigned = rows.filter((r) => r.firmId !== null);
    const unassigned = rows.filter((r) => r.firmId === null);
    let written = 0;
    written += await writeChunks(assigned, false);
    written += await writeChunks(unassigned, true);
    return { written };
  },

  async startJob({ kind, triggeredBy, fromDate, toDate }) {
    const [row] = await db
      .insert(leadSyncJobs)
      .values({
        kind,
        status: "running",
        startedAt: new Date(),
        triggeredBy,
        fromDate,
        toDate,
      })
      .returning();
    return row.id;
  },

  async finishJob({ jobId, status, errorMessage, leadsIngested }) {
    await db
      .update(leadSyncJobs)
      .set({
        status,
        completedAt: new Date(),
        errorMessage: errorMessage?.slice(0, 2000) ?? null,
        leadsIngested,
      })
      .where(eq(leadSyncJobs.id, jobId));
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
        then ${now}
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
    lastSyncedAt: now,
    updatedAt: now,
  };
}

async function writeChunks(
  rows: readonly PlannedLead[],
  unassigned: boolean,
): Promise<number> {
  if (rows.length === 0) return 0;
  const now = new Date();
  let written = 0;
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    const chunk = rows.slice(i, i + WRITE_CHUNK).map(toInsertValues);
    const stmt = db.insert(leads).values(chunk);
    if (unassigned) {
      // Targets leads_unassigned_callrail_person_idx, the PARTIAL unique
      // index. The plain unique constraint does not constrain these rows at
      // all: firm_id is null and Postgres treats NULL as distinct from
      // NULL, so without this predicate every run would insert a fresh
      // duplicate of every admin-queue lead.
      await stmt.onConflictDoUpdate({
        target: [leads.callrailId, leads.personSuffix],
        targetWhere: isNull(leads.firmId),
        set: conflictSet(now),
      });
    } else {
      await stmt.onConflictDoUpdate({
        target: [leads.firmId, leads.callrailId, leads.personSuffix],
        set: conflictSet(now),
      });
    }
    written += chunk.length;
  }
  return written;
}
