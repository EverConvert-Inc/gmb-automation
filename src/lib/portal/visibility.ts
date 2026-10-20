// The client-visibility and month rules, as pure functions — and the SQL
// form of the visibility rule (clientVisibleSql), so db.ts and the admin
// queries apply the same one.
//
// This file exists so the rules are testable without a database, AND so
// db.ts can re-check every row Postgres returns: if the two ever disagree,
// the portal throws rather than showing a row the rules say a firm must not
// see. The visibility rule itself is at the end: clientVisibility.

import { CLIENT_HIDDEN_STATUS_TAGS, type StatusTag } from "@/lib/leads/status-from-tags";
import {
  easternWallClockToDate,
  firstOfMonthIsoEastern,
  firstOfPreviousMonthIsoEastern,
} from "@/lib/date-utils";

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

// ---------------------------------------------------------------------------
// Who the client sees: Pending or Signed with no negative tag, or approved
// ---------------------------------------------------------------------------
//
// THE rule, for the portal (its SQL via negativeTagsSql, its row re-check via
// clientVisibility) and for every admin count, badge and queue reason. A lead
// is shown to its firm when it is not under review and EITHER
//   - staff approved it for the client ("Approve for client"), and every
//     negative tag it carries now was already there at approval; OR
//   - it carries no negative tag, and its status is Signed or Pending
//     (portalStatusLabel: Pending only from a Pending tag, a person's own
//     Pending note status, or a staff override to pending).
// Opportunity-only leads and leads carrying any negative tag wait for
// approval; the latter are in the admin queue as "Negative tag - needs
// review". A Signed lead with a negative tag waits too.

/** ASCII whitespace only, so the TypeScript and SQL forms cannot disagree by locale. */
const WS_RUN = /[ \t\n\r\f]+/g;

/** A tag as compared: trimmed, lower case, inner whitespace collapsed. */
export function tagKey(tag: string): string {
  // Spaces only at the ends, exactly as Postgres btrim() does.
  return tag.replace(WS_RUN, " ").replace(/^ +| +$/g, "").toLowerCase();
}

/** Lost, Rejected, No Case, Referred out, No Contact, Declined — as tagKey()s. */
export const NEGATIVE_TAG_KEYS: readonly string[] = CLIENT_HIDDEN_STATUS_TAGS.map(tagKey);

/**
 * The negative tags a lead carries, as sorted unique tagKey()s: any of its
 * CallRail tags (raw_tags, whatever else it carries) and its matched status
 * word, which for a person on a multi-person note is that person's own.
 */
export function negativeTagsOf(v: { rawTags: readonly string[]; statusTagMatched: string | null }): string[] {
  const found = new Set<string>();
  for (const t of [...v.rawTags, ...(v.statusTagMatched === null ? [] : [v.statusTagMatched])]) {
    const k = tagKey(t);
    if (NEGATIVE_TAG_KEYS.includes(k)) found.add(k);
  }
  return [...found].sort();
}

const NEGATIVE_KEYS_SQL = NEGATIVE_TAG_KEYS.map((k) => `'${k.replace(/'/g, "''")}'`).join(", ");

/**
 * negativeTagsOf as SQL: a sorted text[] for the lead aliased `alias` ("l"
 * in the portal, "leads" in admin queries). Fixed SQL, no user input.
 */
export function negativeTagsSql(alias: string): string {
  const key = (expr: string) => `lower(btrim(regexp_replace(${expr}, E'[ \\t\\n\\r\\f]+', ' ', 'g')))`;
  return `(select coalesce(array_agg(distinct x.k order by x.k), '{}') from (
      select ${key("t.tag")} as k from unnest(${alias}.raw_tags) as t(tag)
      union all select ${key(`${alias}.status_tag_matched`)}
    ) as x where x.k in (${NEGATIVE_KEYS_SQL}))`;
}

/**
 * The visibility condition itself as SQL over `alias`, given its negative
 * tags expression. Shared by the portal's visibleTo — the same shape as
 * clientVisibility below.
 */
export function clientVisibleSql(alias: string): string {
  const neg = negativeTagsSql(alias);
  // coalesce(…, false): strictly true or false, never NULL, so nothing built
  // on this (a NOT, a count) can read an unknown as anything else.
  return `coalesce((
       (${alias}.client_approved_at is not null and ${neg} <@ ${alias}.client_approved_negative_tags)
    or (cardinality(${neg}) = 0 and (
             coalesce(${alias}.status_override, ${alias}.status_parsed) = 'signed'
          or ${alias}.status_override = 'pending'
          or (${alias}.status_override is null and ${alias}.status_tag_matched = 'Pending')
       ))
  ), false)`;
}

/** The SQL for "in the admin queue for a negative tag": carries one, not covered by an approval. */
export function negativeNeedsReviewSql(alias: string): string {
  const neg = negativeTagsSql(alias);
  return `(cardinality(${neg}) > 0 and not (${alias}.client_approved_at is not null and ${neg} <@ ${alias}.client_approved_negative_tags))`;
}

export type ClientApproval = {
  clientApprovedAt: Date | null;
  /** The negative tags (tagKey()s) the lead carried when approved. */
  clientApprovedNegativeTags: readonly string[];
};

/** An approval covers the lead while every negative tag it carries now was there at approval. */
export function approvalCovers(a: ClientApproval, negativeTags: readonly string[]): boolean {
  return a.clientApprovedAt !== null && negativeTags.every((t) => a.clientApprovedNegativeTags.includes(t));
}

export type ClientVisibilityInput = StatusLabelInput &
  ClientApproval & {
    needsReview: boolean;
    /** negativeTagsOf(...) — or the SQL's negative_tags column. */
    negativeTags: readonly string[];
  };

/** The two labels a client can see. */
export type ClientLabel = "signed" | "pending";

export type ClientVisibility =
  | { visible: true; label: ClientLabel; approved: boolean }
  | { visible: false; reason: "needs_review" }
  | { visible: false; reason: "negative_tag"; negativeTags: readonly string[]; approvedEarlier: boolean }
  | { visible: false; reason: "opportunity_only" };

export function clientVisibility(v: ClientVisibilityInput): ClientVisibility {
  if (v.needsReview) return { visible: false, reason: "needs_review" };
  const label: ClientLabel = v.effectiveStatus === "signed" ? "signed" : "pending";
  if (approvalCovers(v, v.negativeTags)) return { visible: true, label, approved: true };
  if (v.negativeTags.length > 0) {
    return { visible: false, reason: "negative_tag", negativeTags: v.negativeTags, approvedEarlier: v.clientApprovedAt !== null };
  }
  if (portalStatusLabel(v) === "opportunity") return { visible: false, reason: "opportunity_only" };
  return { visible: true, label, approved: false };
}

export function isVisibleToClient(v: ClientVisibilityInput): boolean {
  return clientVisibility(v).visible;
}

export const CLIENT_LABEL_TEXT: Record<ClientLabel, string> = { signed: "Signed", pending: "Pending" };
