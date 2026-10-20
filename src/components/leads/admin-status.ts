// The status admin pages show for a lead: the portal's own label, or — for a
// lead the portal hides because of a rejection-style tag — that tag. Built
// on the portal's functions (portalStatusLabel, HIDDEN_TAGS), never a copy,
// so admin and client cannot read a lead differently. The stored status
// collapses those tags to 'pending', which on its own would read as still
// pending.
import { HIDDEN_TAGS, PORTAL_STATUS_TEXT, portalStatusLabel, type PortalStatusLabel } from "@/lib/portal/visibility";

export type AdminStatusView =
  | { kind: "label"; label: PortalStatusLabel; text: string }
  | { kind: "hidden"; tag: string };

export function adminStatusView(r: {
  /** coalesce(status_override, status_parsed) */
  status: string;
  statusOverride: string | null;
  statusTagMatched: string | null;
}): AdminStatusView {
  const hasStatusOverride = r.statusOverride !== null;
  // Same test as the portal's isClientVisible: a staff override un-hides.
  if (!hasStatusOverride && r.statusTagMatched !== null && HIDDEN_TAGS.includes(r.statusTagMatched)) {
    return { kind: "hidden", tag: r.statusTagMatched };
  }
  const label = portalStatusLabel({ effectiveStatus: r.status, hasStatusOverride, statusTagMatched: r.statusTagMatched });
  return { kind: "label", label, text: PORTAL_STATUS_TEXT[label] };
}

/** What the tags alone say (the drawer's "From tags" choice): no override. */
export function fromTagsStatusText(r: { statusParsed: string; statusTagMatched: string | null }): string {
  const v = adminStatusView({ status: r.statusParsed, statusOverride: null, statusTagMatched: r.statusTagMatched });
  return v.kind === "hidden" ? `${v.tag}, hidden from client` : v.text;
}
