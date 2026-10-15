import { PORTAL_STATUS_TEXT, type PortalStatusLabel } from "@/lib/portal/visibility";

// One entry per label; a new label in visibility.ts fails typecheck here
// until it has a style. Colours for both modes live in portal-theme.css.
const STATUS_CLASS: Record<PortalStatusLabel, string> = {
  signed: "portal-status portal-status-signed",
  pending: "portal-status portal-status-pending",
  opportunity: "portal-status portal-status-opportunity",
};

/** The label only — never a date. */
export function StatusBadge({ status }: { status: PortalStatusLabel }) {
  return (
    <span className={STATUS_CLASS[status]}>{PORTAL_STATUS_TEXT[status]}</span>
  );
}
