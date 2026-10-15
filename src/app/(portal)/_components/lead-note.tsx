"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { noteDraftState, revertedDraft } from "../_lib/note-editor";
import { formatPortalShortDate } from "./format";
import { portalButton } from "./ui";

export type NoteValue = { body: string; date: string } | null;

/** The field grows with its text up to this height, then scrolls. */
const MAX_FIELD_HEIGHT_PX = 200;
/** How long the saved checkmark stays before fading. */
const SAVED_MARK_MS = 1800;

/**
 * One editable field holding the firm's current note. Quiet (no border)
 * until hovered or focused. Save and Cancel appear only when the text
 * differs from the saved note; Ctrl/Cmd+Enter saves, Escape reverts.
 *
 * Saving never edits or deletes: it adds a NEW note, and the newest of the
 * firm's own notes is what the field shows. An empty or unchanged field
 * never saves. A newer note from staff is shown above, read-only.
 */
export function LeadNote({
  leadId,
  firmNote,
  staffNote,
  maxLength,
}: {
  leadId: string;
  firmNote: NoteValue;
  staffNote: NoteValue;
  maxLength: number;
}) {
  const router = useRouter();
  const fieldId = useId();
  const [saved, setSaved] = useState<NoteValue>(firmNote);
  const [draft, setDraft] = useState(firmNote?.body ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [, startRefresh] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const savedText = saved?.body ?? "";
  const { dirty, canSave } = noteDraftState(savedText, draft, maxLength);

  // A refresh brings the server's copy. Adopt it, but never over unsaved typing.
  const lastServerBody = useRef(firmNote?.body ?? "");
  useEffect(() => {
    const incoming = firmNote?.body ?? "";
    if (incoming === lastServerBody.current) return;
    lastServerBody.current = incoming;
    setSaved(firmNote);
    setDraft((d) => (d.trim() === savedText.trim() ? incoming : d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmNote]);

  // Grow (or shrink back) to fit the text.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_FIELD_HEIGHT_PX)}px`;
    el.style.overflowY = el.scrollHeight > MAX_FIELD_HEIGHT_PX ? "auto" : "hidden";
  }, [draft]);

  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), SAVED_MARK_MS);
    return () => clearTimeout(t);
  }, [justSaved]);

  function revert() {
    setDraft(revertedDraft(savedText));
    setError(null);
  }

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || !canSave) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/leads/${encodeURIComponent(leadId)}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ body: draft }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        note?: { body: string; date: string };
      };
      if (!res.ok || !data.note) throw new Error(data.error ?? "Could not save the note. Please try again.");
      setSaved({ body: data.note.body, date: data.note.date });
      setDraft(data.note.body);
      setJustSaved(true);
      // Re-reads the list, so what is shown is what the server stored.
      startRefresh(() => router.refresh());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const length = draft.trim().length;
  const nearLimit = length > maxLength * 0.9;

  return (
    <div className="space-y-2">
      {staffNote && (
        <div className="rounded-md bg-muted/60 px-2.5 py-2">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
            From EverConvert
          </p>
          <p className="mt-0.5 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-relaxed text-muted-foreground">
            {staffNote.body}
          </p>
        </div>
      )}

      <form
        ref={formRef}
        onSubmit={save}
        className="space-y-1.5"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          } else if (e.key === "Escape" && dirty) {
            e.preventDefault();
            revert();
          }
        }}
      >
        <label htmlFor={fieldId} className="sr-only">
          Note
        </label>
        <textarea
          ref={textRef}
          id={fieldId}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          maxLength={maxLength}
          rows={1}
          placeholder="Add a note"
          disabled={busy}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fieldId}-error` : undefined}
          className={cn(
            "-mx-2 block w-[calc(100%+1rem)] resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm leading-relaxed text-foreground transition-colors",
            "placeholder:text-muted-foreground/80 hover:border-border hover:bg-card",
            "focus-visible:border-ring focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
            "[overflow-wrap:anywhere]",
            (dirty || error) && "border-border bg-card",
            error && "border-destructive",
          )}
        />

        {error && (
          <p id={`${fieldId}-error`} role="alert" className="portal-error-text flex items-start gap-1.5 text-xs">
            <CircleAlert aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        )}

        {dirty ? (
          <div className="flex items-center gap-2">
            {canSave && (
              <button type="submit" disabled={busy} className={portalButton("primary", "sm")}>
                {busy && <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" />}
                {busy ? "Saving…" : "Save"}
              </button>
            )}
            <button type="button" onClick={revert} disabled={busy} className={portalButton("ghost", "sm")}>
              Cancel
            </button>
            <span className={cn("ml-auto text-xs tabular-nums", nearLimit ? "portal-error-text" : "text-muted-foreground")}>
              {length}/{maxLength}
            </span>
          </div>
        ) : (
          saved && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Updated {formatPortalShortDate(saved.date)}
              <Check
                aria-hidden
                className={cn(
                  "h-3.5 w-3.5 text-[hsl(var(--portal-accent))] transition-opacity duration-700",
                  justSaved ? "opacity-100" : "opacity-0",
                )}
              />
            </p>
          )
        )}
        <span role="status" className="sr-only">
          {justSaved ? "Saved" : ""}
        </span>
      </form>
    </div>
  );
}
