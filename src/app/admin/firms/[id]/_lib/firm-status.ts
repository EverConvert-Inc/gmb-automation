// Counts for the firm page's status strip. Staff-only (the page calls these
// after checkAdmin); read-only; run one after another by the caller.

import { and, count, eq, gte, lt, or } from "drizzle-orm";
import { db } from "@/lib/db/client";

type Db = Pick<typeof db, "select">;
import { leads } from "@/lib/db/schema";
import { adminQueueCondition } from "@/lib/leads/queries-admin";
import { assertRowShape } from "@/lib/leads/row-guard";
import { presetRange } from "@/lib/portal/range";
import { hasUsableName } from "@/lib/portal/usable-name";
import { inRange, isClientVisible, monthAnchor } from "@/lib/portal/visibility";

/** The facts "visible now" needs about one lead — the same inputs the portal's rule takes. */
export type VisibilityFacts = {
  effectiveStatus: string;
  effectiveOpportunity: boolean;
  needsReview: boolean;
  hasStatusOverride: boolean;
  statusTagMatched: string | null;
  occurredAt: Date;
  signedAt: Date | null;
  /** coalesce(name_override, name_parsed) */
  name: string | null;
  /** Staff typed a name in the drawer (name_override set and not blank). */
  hasNameOverride: boolean;
};

/** This month (to today) plus last month — exactly what the portal can show. */
export function portalWindowNow(): { start: Date; endExclusive: Date } {
  return { start: presetRange("previous").start, endExclusive: presetRange("current").endExclusive };
}

/**
 * How many of these leads the firm's portal shows right now. Uses the
 * portal's OWN functions (isClientVisible, hasUsableName, monthAnchor) — not
 * a copy of the rule — so the admin count cannot drift from what the client
 * sees.
 */
export function countVisibleNow(rows: readonly VisibilityFacts[], window = portalWindowNow()): number {
  let n = 0;
  for (const r of rows) {
    if (!isClientVisible(r)) continue;
    if (!hasUsableName(r)) continue;
    if (!inRange(monthAnchor({ effectiveStatus: r.effectiveStatus, signedAt: r.signedAt, occurredAt: r.occurredAt }), window)) {
      continue;
    }
    n += 1;
  }
  return n;
}

/** Candidates only: any lead whose call OR signing falls in the window (a signed lead belongs to the month it was signed). */
export function buildVisibleNowCandidatesQuery(database: Db, firmId: string, window: { start: Date; endExclusive: Date }) {
  return database
    .select({
      statusOverride: leads.statusOverride,
      statusParsed: leads.statusParsed,
      isOpportunityOverride: leads.isOpportunityOverride,
      isOpportunityParsed: leads.isOpportunityParsed,
      needsReview: leads.needsReview,
      statusTagMatched: leads.statusTagMatched,
      occurredAt: leads.occurredAt,
      signedAt: leads.signedAt,
      nameOverride: leads.nameOverride,
      nameParsed: leads.nameParsed,
    })
    .from(leads)
    .where(
      and(
        eq(leads.firmId, firmId),
        lt(leads.occurredAt, window.endExclusive),
        or(gte(leads.occurredAt, window.start), gte(leads.signedAt, window.start)),
      ),
    );
}

export async function visibleNowCount(firmId: string): Promise<number> {
  const window = portalWindowNow();
  // The rule itself is applied in countVisibleNow, with the portal's functions.
  const rows = await buildVisibleNowCandidatesQuery(db, firmId, window);
  assertRowShape("firm status: visible now", rows, {
    statusParsed: "string",
    isOpportunityParsed: "boolean",
    needsReview: "boolean",
    occurredAt: "date",
  });
  return countVisibleNow(
    rows.map((r) => ({
      effectiveStatus: r.statusOverride ?? r.statusParsed,
      effectiveOpportunity: r.isOpportunityOverride ?? r.isOpportunityParsed,
      needsReview: r.needsReview,
      hasStatusOverride: r.statusOverride !== null,
      statusTagMatched: r.statusTagMatched,
      occurredAt: r.occurredAt,
      signedAt: r.signedAt,
      name: r.nameOverride ?? r.nameParsed,
      // Same test as the portal SQL's STAFF_NAMED_SQL: set and not blank.
      hasNameOverride: r.nameOverride !== null && r.nameOverride.trim() !== "",
    })),
    window,
  );
}

/** This firm's rows in the admin queue: needs review, parse failed, or a possible duplicate. */
export function buildQueueCountQuery(database: Db, firmId: string) {
  return database
    .select({ n: count() })
    .from(leads)
    .where(and(eq(leads.firmId, firmId), adminQueueCondition()));
}

export async function queueCount(firmId: string): Promise<number> {
  const rows = await buildQueueCountQuery(db, firmId);
  assertRowShape("firm status: queue", rows, { n: "number" });
  return rows[0]?.n ?? 0;
}
