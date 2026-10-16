"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { FormError } from "@/components/ui/form";

export function deactivateConfirmText(firmName: string): string {
  return `Deactivate ${firmName}? Its clients lose portal access and new leads stop routing to it. Leads it already holds are kept.`;
}

/** Firm name, slug, and the Active switch (saves on change; asks before deactivating). */
export function FirmHeader({
  firm,
}: {
  firm: { id: string; name: string; slug: string; isActive: boolean };
}) {
  const router = useRouter();
  const [active, setActive] = useState(firm.isActive);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startRefresh] = useTransition();

  async function toggle() {
    const next = !active;
    if (!next && !confirm(deactivateConfirmText(firm.name))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/firms/${firm.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setActive(next);
      startRefresh(() => router.refresh());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-bold tracking-tight">{firm.name}</h1>
          <p className="font-mono text-xs text-muted-foreground">{firm.slug}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={active}
          aria-label="Firm active"
          disabled={busy}
          onClick={toggle}
          className="inline-flex items-center gap-2 rounded-full border bg-card py-1 pl-1 pr-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-text)] disabled:opacity-60"
        >
          <span
            aria-hidden
            className={cn(
              "relative h-5 w-9 rounded-full transition-colors",
              active ? "bg-[var(--fu-solid)]" : "bg-muted-foreground/30",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                active ? "translate-x-4" : "translate-x-0.5",
              )}
            />
          </span>
          {active ? "Active" : "Inactive"}
        </button>
      </div>
      <FormError>{error}</FormError>
    </div>
  );
}
