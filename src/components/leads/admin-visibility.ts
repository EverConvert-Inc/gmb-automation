// The portal's client-visibility rule (clientVisibility in
// src/lib/portal/visibility.ts) applied to an admin lead row. Every admin
// place that says whether a client sees a lead goes through here, so admin
// and portal cannot read a lead differently.
import { CLIENT_HIDDEN_STATUS_TAGS } from "@/lib/leads/status-from-tags";
import { clientVisibility, negativeTagsOf, tagKey, type ClientVisibility } from "@/lib/portal/visibility";
import type { AdminLeadRow } from "@/lib/leads/queries-admin";

export function adminClientVisibility(
  r: Pick<
    AdminLeadRow,
    "status" | "statusOverride" | "statusTagMatched" | "needsReview" | "rawTags" | "clientApprovedAt" | "clientApprovedNegativeTags"
  >,
): ClientVisibility {
  return clientVisibility({
    effectiveStatus: r.status,
    hasStatusOverride: r.statusOverride !== null,
    statusTagMatched: r.statusTagMatched,
    needsReview: r.needsReview,
    negativeTags: negativeTagsOf(r),
    clientApprovedAt: r.clientApprovedAt,
    clientApprovedNegativeTags: r.clientApprovedNegativeTags,
  });
}

/** CallRail's spelling of each negative tag, by its tagKey. */
const NEGATIVE_TAG_NAME = new Map(CLIENT_HIDDEN_STATUS_TAGS.map((t) => [tagKey(t), t as string]));

/** Negative tag keys as CallRail spells them, joined: "Lost, No Case". */
export function negativeTagNames(keys: readonly string[]): string {
  return keys.map((k) => NEGATIVE_TAG_NAME.get(k) ?? k).join(", ");
}
