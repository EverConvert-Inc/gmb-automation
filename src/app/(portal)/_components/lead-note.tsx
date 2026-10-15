"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPortalDate } from "./format";
import { portalButton, portalInput } from "./ui";

export type LatestNote = { body: string; author: "client" | "staff"; date: string } | null;

/** The field starts one line tall and grows with its text up to this height, then scrolls. */
const MAX_FIELD_HEIGHT_PX = 200;

/**
 * The latest note on a lead, and an always-visible note field under it. The
 * field is one line tall and grows as you type; Save appears once there is
 * text. Only the lead id and the note text are sent; the firm and the author
 * come from the session on the server.
 *
 * Keyboard: Ctrl/Cmd+Enter saves; Escape clears the draft.
 */
export function LeadNote({
  leadId,
  latestNote,
  maxLength,
}: {
  leadId: string;
  latestNote: LatestNote;
  maxLength: number;
}) {
  const router = useRouter();
  const fieldId = useId();
  const [note, setNote] = useState<LatestNote>(latestNote);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [, startRefresh] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // A refresh after saving brings the server's copy; show that one.
  useEffect(() => setNote(latestNote), [latestNote]);

  // Grow (or shrink back) to fit the text.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_FIELD_HEIGHT_PX)}px`;
    el.style.overflowY = el.scrollHeight > MAX_FIELD_HEIGHT_PX ? "auto" : "hidden";
  }, [draft]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy || draft.trim().length === 0) return;
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
      setNote({ body: data.note.body, author: "client", date: data.note.date });
      setDraft("");
      setSaved(true);
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
    <div className="space-y-2.5">
      {note ? (
        <div className="space-y-1">
          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-relaxed text-foreground">{note.body}</p>
          <p className="text-xs text-muted-foreground">
            {note.author === "client" ? "Your firm" : "EverConvert"} · {formatPortalDate(note.date)}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No notes yet</p>
      )}

      <form
        ref={formRef}
        onSubmit={save}
        className="space-y-2"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            formRef.current?.requestSubmit();
          } else if (e.key === "Escape" && draft) {
            e.preventDefault();
            setDraft("");
            setError(null);
          }
        }}
      >
        <label htmlFor={fieldId} className="sr-only">
          Add a note
        </label>
        <textarea
          ref={textRef}
          id={fieldId}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setSaved(false);
            if (error) setError(null);
          }}
          maxLength={maxLength}
          rows={1}
          placeholder="Add a note…"
          disabled={busy}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fieldId}-error` : undefined}
          className={cn(portalInput, "resize-none overflow-hidden py-1.5 leading-relaxed", error && "border-destructive")}
        />
        {error && (
          <p id={`${fieldId}-error`} role="alert" className="portal-error-text flex items-start gap-1.5 text-xs">
            <CircleAlert aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        )}
        {length > 0 ? (
          <div className="flex items-center gap-2">
            <button type="submit" disabled={busy} className={portalButton("primary", "sm")}>
              {busy && <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" />}
              {busy ? "Saving…" : "Save note"}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft("");
                setError(null);
                textRef.current?.focus();
              }}
              disabled={busy}
              className={portalButton("ghost", "sm")}
            >
              Cancel
            </button>
            <span className={cn("ml-auto text-xs tabular-nums", nearLimit ? "portal-error-text" : "text-muted-foreground")}>
              {length}/{maxLength}
            </span>
          </div>
        ) : (
          <p role="status" className="flex items-center gap-1 text-xs text-muted-foreground empty:hidden">
            {saved && (
              <>
                <Check aria-hidden className="h-3.5 w-3.5" />
                Note saved
              </>
            )}
          </p>
        )}
      </form>
    </div>
  );
}
