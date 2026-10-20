// The status admin pages show for a lead, as the client sees it — the
// portal's own rule (clientVisibility, via adminClientVisibility), never a
// copy: Signed or Pending when shown (and whether staff approved it), the
// negative tags that hold it back, Opportunity-only waiting for approval,
// or under review.
import { CLIENT_LABEL_TEXT, PORTAL_STATUS_TEXT, portalStatusLabel, type ClientLabel } from "@/lib/portal/visibility";
import type { AdminLeadRow } from "@/lib/leads/queries-admin";
import { adminClientVisibility, negativeTagNames } from "./admin-visibility";

export type AdminStatusView =
  | { kind: "shown"; label: ClientLabel; text: string; approved: boolean }
  | { kind: "negative"; tags: string }
  | { kind: "opportunity" }
  | { kind: "review"; text: string };

type StatusRow = Pick<
  AdminLeadRow,
  "status" | "statusOverride" | "statusTagMatched" | "needsReview" | "rawTags" | "clientApprovedAt" | "clientApprovedNegativeTags"
>;

export function adminStatusView(r: StatusRow): AdminStatusView {
  const v = adminClientVisibility(r);
  if (v.visible) return { kind: "shown", label: v.label, text: CLIENT_LABEL_TEXT[v.label], approved: v.approved };
  if (v.reason === "negative_tag") return { kind: "negative", tags: negativeTagNames(v.negativeTags) };
  if (v.reason === "opportunity_only") return { kind: "opportunity" };
  // Under review: what the status itself says, Opportunity included.
  const label = portalStatusLabel({ effectiveStatus: r.status, hasStatusOverride: r.statusOverride !== null, statusTagMatched: r.statusTagMatched });
  return { kind: "review", text: PORTAL_STATUS_TEXT[label] };
}

/** What the tags alone say (the drawer's "From tags" choice): the same view without the status override. */
export function fromTagsStatusText(r: StatusRow & { statusParsed: string }): string {
  const v = adminStatusView({ ...r, status: r.statusParsed, statusOverride: null });
  if (v.kind === "negative") return `${v.tags}, needs review`;
  if (v.kind === "opportunity") return "Opportunity, not shown";
  return v.text;
}
