"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type Status =
  | { kind: "idle" }
  | { kind: "syncing" }
  | { kind: "done"; synced: number; errors: Array<{ account: string; message: string }>; discoveryError: string | null }
  | { kind: "error"; message: string };

// Re-runs account discovery, then pulls Reddit spend for every active ad
// account across the range currently selected in the date filter. Auth
// rides on the normal Supabase middleware gate over /api/reddit/*.
export function SyncRedditNowButton({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function sync() {
    setStatus({ kind: "syncing" });
    try {
      const res = await fetch("/api/reddit/sync-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        synced?: number;
        errors?: Array<{ account: string; message: string }>;
        discovery?: { error?: string };
      };
      if (!res.ok || typeof body.synced !== "number") {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setStatus({
        kind: "done",
        synced: body.synced,
        errors: body.errors ?? [],
        discoveryError: body.discovery?.error ?? null,
      });
      // The report is server-rendered once per load; refresh to show the
      // freshly synced rows.
      router.refresh();
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
    }
  }

  const busy = status.kind === "syncing";
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        onClick={sync}
        disabled={busy}
        title={`Resync Reddit spend (${from} → ${to}) for every active ad account`}
      >
        <RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} />
        {busy ? "Syncing…" : "Sync now"}
      </Button>
      {status.kind === "done" && status.errors.length === 0 && !status.discoveryError && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          Synced {status.synced} account{status.synced === 1 ? "" : "s"}.
        </p>
      )}
      {status.kind === "done" && (status.errors.length > 0 || status.discoveryError) && (
        <p className="max-w-xs text-right text-xs text-amber-800 dark:text-amber-400">
          Synced {status.synced} account{status.synced === 1 ? "" : "s"}
          {status.errors.length > 0 &&
            `, ${status.errors.length} failed (${status.errors[0].account}: ${status.errors[0].message})`}
          {status.discoveryError && `. Account discovery failed: ${status.discoveryError}`}
        </p>
      )}
      {status.kind === "error" && (
        <p className="max-w-xs text-right text-xs text-red-700 dark:text-red-400">{status.message}</p>
      )}
    </div>
  );
}
