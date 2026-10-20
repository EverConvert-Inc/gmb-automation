"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { APPROVE_URL } from "./admin-lead-actions";
import { firmButtonClasses } from "./firm-button";

/**
 * The queue's bulk "Approve for client": wraps an AdminLeadsTable rendered
 * with `selectable`, and approves every ticked row in one request to the
 * same route the drawer uses.
 */
export function BulkApproveForm({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startRefresh] = useTransition();

  const boxes = () => [...(form.current?.querySelectorAll<HTMLInputElement>('input[name="leadId"]') ?? [])];
  const recount = () => setSelected(boxes().filter((b) => b.checked).length);

  function toggleAll() {
    const all = boxes();
    const check = all.some((b) => !b.checked);
    for (const b of all) b.checked = check;
    recount();
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const leadIds = new FormData(e.currentTarget).getAll("leadId").map(String);
    if (leadIds.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(APPROVE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      startRefresh(() => router.refresh());
      setSelected(0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={form} onSubmit={submit} onChange={recount} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={toggleAll}>
          Select all
        </Button>
        <button type="submit" disabled={busy || selected === 0} className={firmButtonClasses("primary")}>
          {busy ? "Approving…" : `Approve selected for client (${selected})`}
        </button>
      </div>
      <FormError>{error}</FormError>
      {children}
    </form>
  );
}
