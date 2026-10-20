import { CLIENT_LABEL_TEXT, type ClientLabel } from "@/lib/portal/visibility";

// One entry per label; a new label in visibility.ts fails typecheck here
// until it has a style. Colours for both modes live in portal-theme.css.
const STATUS_CLASS: Record<ClientLabel, string> = {
  signed: "portal-status portal-status-signed",
  pending: "portal-status portal-status-pending",
};

/** The label only — never a date. */
export function StatusBadge({ status }: { status: ClientLabel }) {
  return (
    <span className={STATUS_CLASS[status]}>{CLIENT_LABEL_TEXT[status]}</span>
  );
}
