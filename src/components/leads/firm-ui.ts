// The firm page's green family, as class names. Every green on the page comes
// from these (or from the primary FirmButton, whose colours they match). The
// tokens live in src/app/admin/firms/[id]/firm-page.css, scoped to .firm-ui.

/** Green text, icons and links. */
export const fuGreenText = "text-[var(--fu-text)]";
export const fuSoft = "bg-[var(--fu-soft)]";
/** A done / active state: badges, step checks, login pills, confirmations. Same look as the primary button. */
export const fuDone = "border border-[var(--fu-border)] bg-[var(--fu-soft)] text-[var(--fu-text)]";
/** The switch's "on" track. */
export const fuAccentBg = "bg-[var(--fu-accent)]";
/** Keyboard focus ring. */
export const fuFocusRing = "focus-visible:ring-[var(--fu-focus)]";
export const fuAttention = "bg-[var(--fu-warn-bg)] text-[var(--fu-warn-text)]";
/** Primary and danger buttons: see firm-button.tsx (one shared component). */
