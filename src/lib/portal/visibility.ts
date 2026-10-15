// The client-visibility and month rules, as pure functions.
//
// The SQL in db.ts applies the same rules in Postgres. This file exists so the
// rules are testable without a database, AND so db.ts can re-check every row
// Postgres returns: if the two ever disagree, the portal throws rather than
// showing a row the rules say a firm must not see.

import { CLIENT_HIDDEN_STATUS_TAGS } from "@/lib/leads/status-from-tags";
import {
  easternWallClockToDate,
  firstOfMonthIsoEastern,
  firstOfPreviousMonthIsoEastern,
} from "@/lib/date-utils";

/** Matched tags that hide a lead from its firm — unless an admin overrode its status. */
export const HIDDEN_TAGS: readonly string[] = [...CLIENT_HIDDEN_STATUS_TAGS];

export type VisibilityInput = {
  /** coalesce(status_override, status_parsed) */
  effectiveStatus: string;
  /** coalesce(is_opportunity_override, is_opportunity_parsed) */
  effectiveOpportunity: boolean;
  needsReview: boolean;
  /** status_override is not null */
  hasStatusOverride: boolean;
  statusTagMatched: string | null;
};

/**
 * Visible = (Signed OR Opportunity) AND NOT needs_review AND NOT hidden by a
 * matched tag — where an explicit status override beats the hidden-tag rule.
 */
export function isClientVisible(v: VisibilityInput): boolean {
  if (v.needsReview) return false;
  if (v.effectiveStatus !== "signed" && !v.effectiveOpportunity) return false;
  if (v.hasStatusOverride) return true;
  return v.statusTagMatched === null || !HIDDEN_TAGS.includes(v.statusTagMatched);
}

/**
 * The instant that decides which month a lead belongs to: a signed lead by
 * its signed date (the call date if that is missing), any other by its call
 * date.
 */
export function monthAnchor(v: {
  effectiveStatus: string;
  signedAt: Date | null;
  occurredAt: Date;
}): Date {
  return v.effectiveStatus === "signed" ? (v.signedAt ?? v.occurredAt) : v.occurredAt;
}

export type PortalMonth = "current" | "previous";

export function isPortalMonth(value: unknown): value is PortalMonth {
  return value === "current" || value === "previous";
}

function nextMonthStart(isoFirstOfMonth: string): string {
  const [y, m] = isoFirstOfMonth.split("-").map(Number);
  const year = m === 12 ? y + 1 : y;
  const month = m === 12 ? 1 : m + 1;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function startOfEasternDay(iso: string): Date {
  const d = easternWallClockToDate(`${iso} 00:00:00`);
  if (!d) throw new Error(`Invalid Eastern date ${iso}`);
  return d;
}

/**
 * An Eastern calendar month as a half-open instant range. Built from
 * date-utils' Eastern helpers; nothing here reads a UTC calendar date.
 * Half-open, so the last second of a month cannot be dropped and a
 * 23:30 Eastern lead on the 31st stays in its own month.
 */
export function portalMonthRange(month: PortalMonth): {
  key: string;
  start: Date;
  endExclusive: Date;
} {
  const first =
    month === "current" ? firstOfMonthIsoEastern() : firstOfPreviousMonthIsoEastern();
  return {
    key: first.slice(0, 7),
    start: startOfEasternDay(first),
    endExclusive: startOfEasternDay(nextMonthStart(first)),
  };
}

export function inRange(at: Date, range: { start: Date; endExclusive: Date }): boolean {
  return at.getTime() >= range.start.getTime() && at.getTime() < range.endExclusive.getTime();
}
