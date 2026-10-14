"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormError, Input, Label, Select, Textarea } from "@/components/ui/form";
import { shouldPromptApply } from "@/lib/leads/lead-overrides";
import { formatEasternDate } from "@/lib/leads/admin-dates";
import type { AdminLeadRow } from "@/lib/leads/queries-admin";

type Patch = Record<string, unknown>;

export function AdminLeadActions({ lead }: { lead: AdminLeadRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Close" : "Edit"}
      </Button>

      {open ? (
        <div className="space-y-3 rounded-md border p-3">
          <div>
            <Label htmlFor={`status-${lead.id}`}>Status</Label>
            <Select
              id={`status-${lead.id}`}
              defaultValue={lead.statusOverride ?? ""}
              disabled={busy}
              onChange={(e) =>
                patch({ statusOverride: e.target.value === "" ? null : e.target.value })
              }
            >
              {/* Clearing the override hands the lead back to its tags. */}
              <option value="">From tags ({lead.statusParsed})</option>
              <option value="pending">Pending</option>
              <option value="signed">Signed</option>
            </Select>
          </div>

          <div>
            <Label htmlFor={`opp-${lead.id}`}>Opportunity</Label>
            <Select
              id={`opp-${lead.id}`}
              defaultValue={
                lead.isOpportunityOverride === null
                  ? ""
                  : lead.isOpportunityOverride
                    ? "yes"
                    : "no"
              }
              disabled={busy}
              onChange={(e) =>
                patch({
                  isOpportunityOverride:
                    e.target.value === "" ? null : e.target.value === "yes",
                })
              }
            >
              <option value="">
                From tags ({lead.isOpportunityParsed ? "yes" : "no"})
              </option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Select>
          </div>

          <OverrideField
            id={`name-${lead.id}`}
            label="Name"
            parsed={lead.nameParsed}
            value={lead.name}
            disabled={busy}
            onSave={(v) => patch({ nameOverride: v })}
          />
          <OverrideField
            id={`phone-${lead.id}`}
            label="Phone"
            parsed={lead.phoneParsed}
            value={lead.phone}
            disabled={busy}
            onSave={(v) => patch({ phoneOverride: v })}
          />

          <form onSubmit={addNote} className="space-y-2 border-t pt-3">
            <Label htmlFor={`note-${lead.id}`}>Add a staff note</Label>
            <Textarea
              id={`note-${lead.id}`}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Visible to the firm in the portal."
            />
            <Button type="submit" size="sm" disabled={busy || !note.trim()}>
              {busy ? "Saving…" : "Add note"}
            </Button>
          </form>

          <FormError>{error}</FormError>
        </div>
      ) : error ? (
        <FormError>{error}</FormError>
      ) : null}
    </div>
  );
}

function OverrideField({
  id,
  label,
  parsed,
  value,
  disabled,
  onSave,
}: {
  id: string;
  label: string;
  parsed: string | null;
  value: string | null;
  disabled: boolean;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={parsed ?? "—"}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || draft === (value ?? "")}
          onClick={() => onSave(draft)}
        >
          Save
        </Button>
      </div>
      {/* Emptying the box clears the override rather than storing a blank. */}
      <p className="mt-1 text-xs text-muted-foreground">
        Empty to revert to {parsed ?? "nothing"}.
      </p>
    </div>
  );
}
