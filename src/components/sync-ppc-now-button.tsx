"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type SweepResult = {
  synced: number;
  errored: number;
  errors: Array<{ message: string }>;
};

type Status =
  | { kind: "idle" }
  | { kind: "syncing" }
  | { kind: "done"; googleAds: SweepResult; callrail: SweepResult }
  | { kind: "error"; message: string };

// Resyncs every active PPC client's Google Ads spend/clicks and CallRail
// calls for whatever range is currently selected in the page's date
// filter — replaces manually curling the cron sync routes, including
// one-off backfills. Auth flows through the same Supabase middleware
// that already protects the rest of /api/ppc/*.
export function SyncPpcNowButton({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function sync() {
    setStatus({ kind: "syncing" });
    try {
      const res = await fetch("/api/ppc/sync-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        googleAds?: SweepResult;
        callrail?: SweepResult;
      };
      if (!res.ok || !body.googleAds || !body.callrail) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setStatus({ kind: "done", googleAds: body.googleAds, callrail: body.callrail });
      // The report below is server-rendered and only fetched once at page
      // load — without this, a successful sync updates the database but
      // the page keeps showing the pre-sync snapshot until a manual reload.
      router.refresh();
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
    }
  }

  const busy = status.kind === "syncing";
  const synced =
    status.kind === "done" ? status.googleAds.synced + status.callrail.synced : 0;
  const totalErrored =
    status.kind === "done" ? status.googleAds.errored + status.callrail.errored : 0;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        onClick={sync}
        disabled={busy}
        title={`Resync Google Ads + CallRail data (${from} → ${to}) for every active PPC client`}
      >
        <RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} />
        {busy ? "Syncing…" : "Sync now"}
      </Button>
      {status.kind === "done" && totalErrored === 0 && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">
          Synced {synced} client{synced === 1 ? "" : "s"}.
        </p>
      )}
      {status.kind === "done" && totalErrored > 0 && (
        <p className="max-w-xs text-right text-xs text-amber-600 dark:text-amber-400">
          Synced {synced} client{synced === 1 ? "" : "s"}, {totalErrored} error
          {totalErrored === 1 ? "" : "s"} (
          {[...status.googleAds.errors, ...status.callrail.errors][0]?.message}
          {totalErrored > 1 ? ", …" : ""})
        </p>
      )}
      {status.kind === "error" && (
        <p className="max-w-xs text-right text-xs text-red-600 dark:text-red-400">
          {status.message}
        </p>
      )}
    </div>
  );
}
