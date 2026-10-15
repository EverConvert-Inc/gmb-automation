// Cross-firm reads for the ADMIN surface only.
//
// Every query here deliberately spans firms, which is exactly what makes it
// unsafe anywhere near the client portal. The portal gets its own
// tenant-scoped accessor that requires a resolved firm id; nothing in this
// file may ever be imported from it.

import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { leadFirms, leadNotes, leads } from "@/lib/db/schema";
import { easternDayRangeToInstants } from "./store";
import { monthRangeEastern } from "./admin-dates";
import { queueReason, type QueueReason } from "./reconcile";
import { assertRowShape } from "./row-guard";

// Checked on the first row only — crosstalk is per RESPONSE, so every row in
// a crossed result is wrong the same way and walking 500 buys nothing.
// Deliberately picks fields whose TYPES differ from the other queries on the
// same page, since a guard distinguishes shapes, not contents.
const LEAD_ROW_SHAPE = {
  id: "string",
  callrailId: "string",
  occurredAt: "date",
  status: "string",
  needsReview: "boolean",
  parseFailed: "boolean",
} as const;

// A page of leads is capped rather than paginated for now: the admin surface
// is for triage, and an unbounded cross-firm read of rows carrying names and
// phone numbers is not something to do by accident.
export const ADMIN_LEAD_LIMIT = 500;

export type AdminNote = {
  body: string;
  authorKind: string;
  authorEmail: string | null;
  createdAt: Date;
};

export type AdminLeadRow = {
  id: string;
  firmId: string | null;
  firmName: string | null;
  source: string;
  callrailId: string;
  personSuffix: string;
  occurredAt: Date;
  /** coalesce(override, parsed) — what anyone downstream actually sees. */
  name: string | null;
  phone: string | null;
  status: string;
  isOpportunity: boolean;
  /** The parsed/override pair, so the admin view can show what was edited. */
  nameParsed: string | null;
  phoneParsed: string | null;
  statusParsed: string;
  statusOverride: string | null;
  isOpportunityParsed: boolean;
  isOpportunityOverride: boolean | null;
  statusTagMatched: string | null;
  /** The CallRail tracker/source. ADMIN ONLY — never shown to a firm. */
  rawSourceName: string | null;
  signedAt: Date | null;
  suggestedStatus: string | null;
  suggestedStatusSeenAt: Date | null;
  needsReview: boolean;
  parseFailed: boolean;
  parseError: string | null;
  possibleDuplicateOf: string | null;
  latestNote: AdminNote | null;
};

const effective = {
  name: sql<string | null>`coalesce(${leads.nameOverride}, ${leads.nameParsed})`,
  phone: sql<string | null>`coalesce(${leads.phoneOverride}, ${leads.phoneParsed})`,
  status: sql<string>`coalesce(${leads.statusOverride}, ${leads.statusParsed})`,
  isOpportunity: sql<boolean>`coalesce(${leads.isOpportunityOverride}, ${leads.isOpportunityParsed})`,
};

const baseColumns = {
  id: leads.id,
  firmId: leads.firmId,
  firmName: leadFirms.name,
  source: leads.source,
  callrailId: leads.callrailId,
  personSuffix: leads.personSuffix,
  occurredAt: leads.occurredAt,
  name: effective.name,
  phone: effective.phone,
  status: effective.status,
  isOpportunity: effective.isOpportunity,
  nameParsed: leads.nameParsed,
  phoneParsed: leads.phoneParsed,
  statusParsed: leads.statusParsed,
  statusOverride: leads.statusOverride,
  isOpportunityParsed: leads.isOpportunityParsed,
  isOpportunityOverride: leads.isOpportunityOverride,
  statusTagMatched: leads.statusTagMatched,
  rawSourceName: leads.rawSourceName,
  signedAt: leads.signedAt,
  suggestedStatus: leads.suggestedStatus,
  suggestedStatusSeenAt: leads.suggestedStatusSeenAt,
  needsReview: leads.needsReview,
  parseFailed: leads.parseFailed,
  parseError: leads.parseError,
  possibleDuplicateOf: leads.possibleDuplicateOf,
};

/** The newest note per lead, in one query rather than one per row. */
async function latestNotesFor(leadIds: string[]): Promise<Map<string, AdminNote>> {
  if (leadIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([leadNotes.leadId], {
      leadId: leadNotes.leadId,
      body: leadNotes.body,
      authorKind: leadNotes.authorKind,
      authorEmail: leadNotes.authorEmail,
      createdAt: leadNotes.createdAt,
    })
    .from(leadNotes)
    .where(inArray(leadNotes.leadId, leadIds))
    .orderBy(leadNotes.leadId, desc(leadNotes.createdAt));
  assertRowShape("latestNotesFor", rows, {
    leadId: "string",
    body: "string",
    authorKind: "string",
    createdAt: "date",
  });
  return new Map(
    rows.map((r) => [
      r.leadId,
      {
        body: r.body,
        authorKind: r.authorKind,
        authorEmail: r.authorEmail,
        createdAt: r.createdAt,
      },
    ]),
  );
}

async function attachNotes(
  rows: Omit<AdminLeadRow, "latestNote">[],
  label: string,
): Promise<AdminLeadRow[]> {
  assertRowShape(label, rows, LEAD_ROW_SHAPE);
  const notes = await latestNotesFor(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, latestNote: notes.get(r.id) ?? null }));
}

/**
 * Leads for one Eastern month, optionally narrowed to a firm.
 *
 * Filtered on occurred_at — when the lead came in — not on signed_at. The
 * signed date decides which month a SIGNED lead counts in for the client's
 * report; the admin list is a work queue, so it is ordered by when the lead
 * arrived, and the signed date is shown as its own column.
 */
export async function listAdminLeads(options: {
  monthKey: string;
  firmId?: string | null;
}): Promise<AdminLeadRow[]> {
  const { fromIso, toIso } = monthRangeEastern(options.monthKey);
  const { start, endExclusive } = easternDayRangeToInstants(fromIso, toIso);

  const conditions = [
    gte(leads.occurredAt, start),
    lt(leads.occurredAt, endExclusive),
  ];
  if (options.firmId === null) {
    conditions.push(isNull(leads.firmId));
  } else if (options.firmId) {
    conditions.push(eq(leads.firmId, options.firmId));
  }

  const rows = await db
    .select(baseColumns)
    .from(leads)
    .leftJoin(leadFirms, eq(leadFirms.id, leads.firmId))
    .where(and(...conditions))
    .orderBy(desc(leads.occurredAt))
    .limit(ADMIN_LEAD_LIMIT);

  return attachNotes(rows, "listAdminLeads");
}

export type AdminQueueRow = AdminLeadRow & { reason: QueueReason };

/**
 * What puts a lead in the admin queue. Shared by the list and the count so
 * they cannot drift. needs_review covers everything hidden from clients;
 * possible_duplicate_of is read separately because a duplicate is NOT hidden.
 */
export function adminQueueCondition() {
  return or(
    eq(leads.needsReview, true),
    isNull(leads.firmId),
    eq(leads.parseFailed, true),
    isNotNull(leads.possibleDuplicateOf),
  );
}

/**
 * The admin queue: anything needing a human. Deliberately NOT month-scoped —
 * a lead that failed to parse in September is still unresolved in October,
 * and a queue that hides it by date is a queue that loses it.
 */
export async function listAdminQueue(): Promise<AdminQueueRow[]> {
  const rows = await db
    .select(baseColumns)
    .from(leads)
    .leftJoin(leadFirms, eq(leadFirms.id, leads.firmId))
    .where(adminQueueCondition())
    .orderBy(desc(leads.occurredAt))
    .limit(ADMIN_LEAD_LIMIT);

  const withNotes = await attachNotes(rows, "listAdminQueue");
  const out: AdminQueueRow[] = [];
  for (const r of withNotes) {
    const reason = queueReason({
      parseFailed: r.parseFailed,
      firmId: r.firmId,
      needsReview: r.needsReview,
      possibleDuplicateOf: r.possibleDuplicateOf,
    });
    // The condition above guarantees a reason; skipping is purely defensive.
    if (reason) out.push({ ...r, reason });
  }
  return out;
}

export async function listFirmOptions(): Promise<
  { id: string; name: string; isActive: boolean }[]
> {
  const rows = await db
    .select({ id: leadFirms.id, name: leadFirms.name, isActive: leadFirms.isActive })
    .from(leadFirms)
    .orderBy(leadFirms.name);
  assertRowShape("listFirmOptions", rows, {
    id: "string",
    name: "string",
    isActive: "boolean",
  });
  return rows;
}

export async function countAdminQueue(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(adminQueueCondition());
  return row?.n ?? 0;
}
