"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, LoaderCircle, MessageSquarePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPortalDate } from "./format";
import { portalAccentText, portalButton, portalInput } from "./ui";

export type LatestNote = { body: string; author: "client" | "staff"; date: string } | null;

/**
 * The latest note on a lead, and an inline editor to add one. Only the lead
 * id and the note text are sent; the firm and the author come from the
 * session on the server.
 *
 * Keyboard: the editor takes focus when opened; Escape cancels and returns
 * focus to "Add note"; Ctrl/Cmd+Enter saves.
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
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [, startRefresh] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);

  // A refresh after saving brings the server's copy; show that one.
  useEffect(() => setNote(latestNote), [latestNote]);
  useEffect(() => {
    if (open) textRef.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    setDraft("");
    setError(null);
    requestAnimationFrame(() => addRef.current?.focus());
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
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
      setSaved(true);
      close();
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
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{note.body}</p>
          <p className="text-xs text-muted-foreground">
            {note.author === "client" ? "Your firm" : "EverConvert"} · {formatPortalDate(note.date)}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No notes yet</p>
      )}

      {open ? (
        <form
          ref={formRef}
          onSubmit={save}
          className="space-y-2 rounded-lg border bg-muted/40 p-2.5"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              close();
            } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              formRef.current?.requestSubmit();
            }
          }}
        >
          <label htmlFor={fieldId} className="sr-only">
            New note
          </label>
          <textarea
            ref={textRef}
            id={fieldId}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setSaved(false);
            }}
            maxLength={maxLength}
            rows={3}
            required
            placeholder="Write a note…"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${fieldId}-error` : undefined}
            className={cn(portalInput, "min-h-[5rem] resize-y", error && "border-destructive")}
          />
          {error && (
            <p id={`${fieldId}-error`} role="alert" className="portal-error-text flex items-start gap-1.5 text-xs">
              <CircleAlert aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={busy || length === 0} className={portalButton("primary", "sm")}>
              {busy && <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" />}
              {busy ? "Saving…" : "Save note"}
            </button>
            <button type="button" onClick={close} disabled={busy} className={portalButton("ghost", "sm")}>
              Cancel
            </button>
            <span className={cn("ml-auto text-xs tabular-nums", nearLimit ? "portal-error-text" : "text-muted-foreground")}>
              {length}/{maxLength}
            </span>
          </div>
        </form>
      ) : (
        <div className="flex items-center gap-3">
          <button
            ref={addRef}
            type="button"
            onClick={() => {
              setSaved(false);
              setOpen(true);
            }}
            className={portalButton("secondary", "sm", portalAccentText)}
          >
            <MessageSquarePlus aria-hidden className="h-3.5 w-3.5" />
            Add note
          </button>
          <span role="status" className="flex items-center gap-1 text-xs text-muted-foreground">
            {saved && (
              <>
                <Check aria-hidden className="h-3.5 w-3.5" />
                Note saved
              </>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
