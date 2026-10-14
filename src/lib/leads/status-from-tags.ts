// Tag -> status resolution for the client-facing lead tracker.
//
// Pure: no DB, no network, no imports. The sync calls this with whatever
// tags CallRail returned; the multi-person note parser's per-person status
// text goes through the same ladder (see resolveStatusFromText below), so
// there is exactly one place that decides what a status word means.
//
// This deliberately does NOT reuse resolveCallRollup / the
// ppc_callrail_tag_categories machinery in callrail.ts. That system answers
// a different question ("is this call real or junk, for an aggregate
// report") against per-client, admin-editable categories. This one answers
// "what status does this individual lead have", off a fixed ladder. Sharing
// them would couple a client-facing surface to a table the internal admin UI
// edits freely.

export type LeadStatus = "pending" | "signed";

// First match wins, top to bottom. Ported verbatim from the dashboard
// automation; the order is the spec, not an implementation detail.
export const STATUS_TAG_LADDER = [
  "Signed",
  "Pending",
  "Lost",
  "Rejected",
  "No Case",
  "Referred out",
  "No Contact",
  "Declined",
] as const;

export type StatusTag = (typeof STATUS_TAG_LADDER)[number];

export const OPPORTUNITY_TAG = "Opportunity";

// Only "Signed" maps to the signed status. Everything else on the ladder
// collapses to pending, because the stored status enum is pending|signed
// (leads_status_parsed_check in schema.ts). The distinction between a lost
// lead and an untouched one survives in matchedTag, NOT in the status — see
// leads.status_tag_matched.
const SIGNED_TAG: StatusTag = "Signed";

// Leads whose matched ladder tag is one of these are never shown in the
// client portal, even when the opportunity flag is set. Without this, a lead
// tagged Lost + Opportunity would surface to the firm as an open
// opportunity, since the portal's visibility rule is "signed OR opportunity".
export const CLIENT_HIDDEN_STATUS_TAGS: readonly StatusTag[] = [
  "Lost",
  "Rejected",
  "No Case",
  "Referred out",
  "No Contact",
  "Declined",
];

export type StatusResolution = {
  status: LeadStatus;
  /** Which ladder tag won, as canonically spelled. Null if none matched. */
  matchedTag: StatusTag | null;
  isOpportunity: boolean;
};

// Case-insensitive, and internal whitespace is collapsed so "Referred  out"
// and "referred out" both match "Referred out". Still a whole-string match —
// never a substring, so a tag named "Not Signed" can never match "Signed".
function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

const LADDER_BY_NORMALIZED = new Map<string, StatusTag>(
  STATUS_TAG_LADDER.map((t) => [normalize(t), t]),
);
const NORMALIZED_OPPORTUNITY = normalize(OPPORTUNITY_TAG);

export function resolveStatusFromTags(
  tags: readonly (string | null | undefined)[] | null | undefined,
): StatusResolution {
  const present = new Set<string>();
  for (const tag of tags ?? []) {
    if (typeof tag !== "string") continue;
    const n = normalize(tag);
    if (n) present.add(n);
  }

  let matchedTag: StatusTag | null = null;
  for (const candidate of STATUS_TAG_LADDER) {
    if (present.has(normalize(candidate))) {
      matchedTag = LADDER_BY_NORMALIZED.get(normalize(candidate)) ?? candidate;
      break;
    }
  }

  return {
    status: matchedTag === SIGNED_TAG ? "signed" : "pending",
    matchedTag,
    // A PARALLEL flag, set whenever the Opportunity tag is present — not
    // only when it is the sole tag. The ported rule read "Opportunity if
    // only that is present" because the source system had one status field;
    // here the spec is explicit that "opportunity is a flag that can sit
    // alongside either" status, so Signed + Opportunity sets both.
    isOpportunity: present.has(NORMALIZED_OPPORTUNITY),
  };
}

// The per-person status text from a multi-person note
// ("Name, Phone, Status"). Same ladder, same matching — a single candidate
// instead of a tag list.
export function resolveStatusFromText(
  statusText: string | null | undefined,
): StatusResolution {
  return resolveStatusFromTags(statusText == null ? [] : [statusText]);
}

export function isClientHiddenStatusTag(
  matchedTag: StatusTag | string | null | undefined,
): boolean {
  if (!matchedTag) return false;
  const n = normalize(matchedTag);
  return CLIENT_HIDDEN_STATUS_TAGS.some((t) => normalize(t) === n);
}
