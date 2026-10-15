"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatPortalDate } from "./format";

export type LatestNote = { body: string; author: "client" | "staff"; date: string } | null;

/**
 * The latest note on a lead, and a form to add one. Only the lead id and the
 * note text are sent; the firm and the author come from the session on the
 * server.
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
  const [note, setNote] = useState<LatestNote>(latestNote);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startRefresh] = useTransition();

  async function save(e: React.FormEvent) {
    e.preventDefault();
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
      if (!res.ok || !data.note) throw new Error(data.error ?? "Could not save the note.");
      setNote({ body: data.note.body, author: "client", date: data.note.date });
      setDraft("");
      setOpen(false);
      // Re-reads the list, so what is shown is what the server stored.
      startRefresh(() => router.refresh());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const remaining = maxLength - draft.trim().length;

  return (
    <div className="min-w-[14rem] space-y-2">
      {note ? (
        <div>
          <p className="whitespace-pre-wrap break-words text-sm">{note.body}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {note.author === "client" ? "Your firm" : "EverConvert"} · {formatPortalDate(note.date)}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No notes yet</p>
      )}

      {open ? (
        <form onSubmit={save} className="space-y-2">
          <textarea
            aria-label="New note"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={maxLength}
            rows={3}
            required
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy || draft.trim().length === 0 || remaining < 0}
              className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save note"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setDraft("");
                setError(null);
              }}
              className="text-xs text-muted-foreground hover:underline"
            >
              Cancel
            </button>
            <span className="ml-auto text-xs text-muted-foreground">{remaining}</span>
          </div>
          {error && (
            <p role="alert" className="text-xs portal-error-text">
              {error}
            </p>
          )}
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs font-medium text-primary hover:underline"
        >
          Add note
        </button>
      )}
    </div>
  );
}
