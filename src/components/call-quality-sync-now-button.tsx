"use client";

import { useState } from "react";
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
  | { kind: "done"; ppc: SweepResult; lsa: SweepResult }
  | { kind: "error"; message: string };

// Resyncs every active PPC/LSA client's CallRail data for whatever range
// is currently selected in the page's date filter — replaces manually
// curling the cron sync routes, including one-off backfills after a
// rollup/config change. Auth flows through the same Supabase middleware
// that already protects /api/ppc/* and /api/lsa/*.
export function CallQualitySyncNowButton({
  from,
  to,
}: {
  from: string;
  to: string;
}) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function sync() {
    setStatus({ kind: "syncing" });
    try {
      const res = await fetch("/api/call-quality/sync-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        ppc?: SweepResult;
        lsa?: SweepResult;
      };
      if (!res.ok || !body.ppc || !body.lsa) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setStatus({ kind: "done", ppc: body.ppc, lsa: body.lsa });
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
    }
  }

  const busy = status.kind === "syncing";
  const totalErrored =
    status.kind === "done" ? status.ppc.errored + status.lsa.errored : 0;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        onClick={sync}
        disabled={busy}
        title={`Resync CallRail data (${from} → ${to}) for every active PPC/LSA client`}
      >
        <RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} />
        {busy ? "Syncing…" : "Sync now"}
      </Button>
      {status.kind === "done" && totalErrored === 0 && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">
          Synced {status.ppc.synced} PPC, {status.lsa.synced} LSA client
          {status.ppc.synced + status.lsa.synced === 1 ? "" : "s"}.
        </p>
      )}
      {status.kind === "done" && totalErrored > 0 && (
        <p className="max-w-xs text-right text-xs text-amber-600 dark:text-amber-400">
          Synced {status.ppc.synced} PPC, {status.lsa.synced} LSA client
          {status.ppc.synced + status.lsa.synced === 1 ? "" : "s"}, {totalErrored}{" "}
          error{totalErrored === 1 ? "" : "s"} (
          {[...status.ppc.errors, ...status.lsa.errors][0]?.message}
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
