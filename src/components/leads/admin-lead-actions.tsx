"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form";
import { shouldPromptApply } from "@/lib/leads/lead-overrides";
import { formatEasternDate } from "@/lib/leads/admin-dates";
import type { AdminLeadRow } from "@/lib/leads/queries-admin";
import { AdminLeadDrawer } from "./admin-lead-drawer";
import { closeLeadDrawer, openLeadDrawer, useLeadDrawerOpen } from "./admin-lead-drawer-store";

type Patch = Record<string, unknown>;

/** "Approve for client" (src/app/api/admin/leads/approve). */
export const APPROVE_URL = "/api/admin/leads/approve";

export function AdminLeadActions({ lead }: { lead: AdminLeadRow }) {
  const router = useRouter();
  // One drawer open at a time, across every table on the page.
  const open = useLeadDrawerOpen(lead.id);
  const trigger = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [, startRefresh] = useTransition();

  // Option B: the prompt only exists where an override disagrees with the
  // tags. Without an override the tag-derived status is already in effect.
  const prompt = shouldPromptApply({
    statusOverride: lead.statusOverride,
    suggestedStatus: lead.suggestedStatus,
  });

  async function patch(body: Patch) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      startRefresh(() => router.refresh());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(APPROVE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: [lead.id] }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      startRefresh(() => router.refresh());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/leads/${lead.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: note }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      setNote("");
      startRefresh(() => router.refresh());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {prompt ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <p>
            CallRail now shows{" "}
            <strong className="capitalize">{lead.suggestedStatus}</strong>
            {lead.suggestedStatusSeenAt
              ? ` on ${formatEasternDate(lead.suggestedStatusSeenAt)}`
              : ""}
            . Apply?
          </p>
          <Button
            type="button"
            size="sm"
            className="mt-1"
            disabled={busy}
            onClick={() => patch({ applySuggestedStatus: true })}
          >
            Apply
          </Button>
        </div>
      ) : null}

      <Button
        ref={trigger}
        type="button"
        variant="ghost"
        size="sm"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? closeLeadDrawer(lead.id) : openLeadDrawer(lead.id))}
      >
        Edit
      </Button>

      {open ? (
        <AdminLeadDrawer
          lead={lead}
          busy={busy}
          error={error}
          note={note}
          onNoteChange={setNote}
          onPatch={patch}
          onAddNote={addNote}
          onApprove={approve}
          onClose={() => closeLeadDrawer(lead.id)}
          returnFocusTo={trigger}
        />
      ) : error ? (
        <FormError>{error}</FormError>
      ) : null}
    </div>
  );
}
