// Class names for the firm page's calm green look. The tokens live in
// src/app/admin/firms/[id]/firm-page.css, scoped to .firm-ui.
export const fuGreenText = "text-[var(--fu-text)]";
export const fuSoft = "bg-[var(--fu-soft)]";
/** Primary action: muted deep green, white text. Passed to the shared Button as className. */
export const fuPrimary =
  "bg-[var(--fu-solid)] text-white hover:bg-[var(--fu-solid-hover)] focus-visible:ring-[var(--fu-text)]";
/** A done/selected state: soft tint, deep green text, thin ring. */
export const fuDone =
  "bg-[var(--fu-soft)] text-[var(--fu-text)] shadow-[inset_0_0_0_1px_var(--fu-ring)]";
export const fuAttention = "bg-[var(--fu-warn-bg)] text-[var(--fu-warn-text)]";
