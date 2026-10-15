/**
 * Whether a popover should close when focus leaves an element inside it.
 *
 * Only when focus actually MOVED somewhere outside (keyboard Tab, or a click
 * on a focusable element elsewhere). A null relatedTarget is NOT a reason to
 * close: it happens when the press lands on something that cannot take
 * focus — an option row inside the popover, or any button in Safari — and
 * closing then hides the popover between mousedown and click, so the click
 * never arrives. Clicks outside are handled by a pointerdown listener.
 */
export function closesOnFocusOut(
  container: { contains(node: unknown): boolean } | null,
  relatedTarget: unknown,
): boolean {
  if (relatedTarget == null) return false;
  return !container?.contains(relatedTarget);
}
