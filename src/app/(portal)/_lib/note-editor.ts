// The note field's rules, pure so they are testable without a browser.
// Notes are append-only: "saving" always adds a new note; there is no edit
// or delete. These rules decide only WHEN the field may save.

export type NoteDraftState = {
  /** The text differs from the saved note (ignoring surrounding whitespace). */
  dirty: boolean;
  /** Dirty, non-empty and within the cap. An empty field never saves — it is never a deletion. */
  canSave: boolean;
};

export function noteDraftState(saved: string, draft: string, maxLength: number): NoteDraftState {
  const text = draft.trim();
  const dirty = text !== saved.trim();
  return { dirty, canSave: dirty && text.length > 0 && text.length <= maxLength };
}

/** What Cancel / Escape puts back: exactly the saved note. */
export function revertedDraft(saved: string): string {
  return saved;
}
