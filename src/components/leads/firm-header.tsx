"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { toggleFirmActive } from "./firm-active";
import { fuAccentBg, fuFocusRing } from "./firm-ui";

export { deactivateConfirmText } from "./firm-active";

/** Firm name, slug, and the Active switch. */
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
  const busyRef = useRef(false);

  // Follow the server after any refresh (another step saving, another tab),
  // but never while a request of our own is in flight.
  useEffect(() => {
    if (!busyRef.current) setActive(firm.isActive);
  }, [firm.isActive]);

  async function onToggle() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const result = await toggleFirmActive({
      firmId: firm.id,
      firmName: firm.name,
      current: active,
      confirmFn: (m) => window.confirm(m),
      fetchFn: (url, init) => fetch(url, init),
      onOptimistic: setActive,
    });
    setActive(result.active);
    if (result.status === "failed") setError(result.error);
    busyRef.current = false;
    setBusy(false);
    if (result.status === "saved") startRefresh(() => router.refresh());
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
          aria-busy={busy}
          aria-label="Firm active"
          disabled={busy}
          onClick={onToggle}
          className={cn(
            "inline-flex items-center gap-2 rounded-full border bg-card py-1 pl-1 pr-3 text-sm font-medium transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-wait disabled:opacity-70",
            fuFocusRing,
          )}
        >
          <span
            aria-hidden
            className={cn(
              "relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors",
              active ? fuAccentBg : "bg-muted-foreground/30",
            )}
          >
            <span
              className={cn(
                "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                active ? "translate-x-4" : "translate-x-0",
              )}
            />
          </span>
          {busy ? "Saving…" : active ? "Active" : "Inactive"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
