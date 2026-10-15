// The client-visibility and month rules, as pure functions.
//
// The SQL in db.ts applies the same rules in Postgres. This file exists so the
// rules are testable without a database, AND so db.ts can re-check every row
// Postgres returns: if the two ever disagree, the portal throws rather than
// showing a row the rules say a firm must not see.

import { CLIENT_HIDDEN_STATUS_TAGS, type StatusTag } from "@/lib/leads/status-from-tags";
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

// ---------------------------------------------------------------------------
// The status label a client sees
// ---------------------------------------------------------------------------

/**
 * TO ADD A LABEL (e.g. Lost, Declined): add it to this union, give it a
 * rule in PORTAL_STATUS_RULES at the right position, and give it text in
 * PORTAL_STATUS_TEXT. Note that the tags those labels come from are
 * currently in CLIENT_HIDDEN_STATUS_TAGS, so such leads are not visible at
 * all today; showing them is a visibility change as well as a label one.
 */
export type PortalStatusLabel = "signed" | "pending" | "opportunity";

export const PORTAL_STATUS_TEXT: Record<PortalStatusLabel, string> = {
  signed: "Signed",
  pending: "Pending",
  opportunity: "Opportunity",
};

export type StatusLabelInput = {
  /** coalesce(status_override, status_parsed) */
  effectiveStatus: string;
  /** status_override is not null */
  hasStatusOverride: boolean;
  /**
   * The ladder word that decided status_parsed: the call's matched tag, or —
   * for a person on a multi-person note who has their own status text — the
   * word from that text, which the sync stores here in place of the tags'.
   */
  statusTagMatched: string | null;
};

const PENDING_TAG: StatusTag = "Pending";

/**
 * First match wins; no match is "opportunity". status_parsed alone never
 * means Pending: it is 'pending' by default whenever no status tag matched,
 * so a real Pending is told apart by WHERE it came from.
 */
const PORTAL_STATUS_RULES: ReadonlyArray<readonly [PortalStatusLabel, (v: StatusLabelInput) => boolean]> = [
  // Override first, then status_parsed.
  ["signed", (v) => v.effectiveStatus === "signed"],
  // An admin who explicitly set the status to pending meant Pending. Without
  // an override, Pending only when a Pending tag — or the person's own
  // Pending in a multi-person note — actually matched.
  ["pending", (v) => (v.hasStatusOverride ? v.effectiveStatus === "pending" : v.statusTagMatched === PENDING_TAG)],
];

export function portalStatusLabel(v: StatusLabelInput): PortalStatusLabel {
  for (const [label, applies] of PORTAL_STATUS_RULES) {
    if (applies(v)) return label;
  }
  return "opportunity";
}
