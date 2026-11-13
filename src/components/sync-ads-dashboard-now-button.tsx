"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type Range = { from: string; to: string };
type Status =
  | { kind: "idle" }
  | { kind: "syncing" }
  | { kind: "done"; rows: number }
  | { kind: "error"; message: string };

// Re-pulls keywords, search terms and Search campaign totals for this
// client, for the window on screen and its comparison window. Auth rides
// on the normal Supabase middleware gate over /api/ads/*.
export function SyncAdsDashboardNowButton({
  clientId,
  range,
  prior,
}: {
  clientId: string;
  range: Range;
  prior: Range;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function sync() {
    setStatus({ kind: "syncing" });
    try {
      const res = await fetch(`/api/ads/${clientId}/sync-now`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Comparison window first, so the newer window is written last.
        body: JSON.stringify({ ranges: [prior, range] }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        results?: Array<{ keywordRows: number; searchTermRows: number }>;
      };
      if (!res.ok || !body.results) throw new Error(body.error ?? `HTTP ${res.status}`);
      setStatus({
        kind: "done",
        rows: body.results.reduce((n, r) => n + r.keywordRows + r.searchTermRows, 0),
      });
      // Reports are server-rendered once per load.
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
        title={`Resync ${range.from} → ${range.to} and the comparison window ${prior.from} → ${prior.to}`}
      >
        <RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} />
        {busy ? "Syncing…" : "Sync both windows"}
      </Button>
      {status.kind === "done" && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          Synced {status.rows.toLocaleString("en-US")} rows.
        </p>
      )}
      {status.kind === "error" && (
        <p className="max-w-xs text-right text-xs text-red-700 dark:text-red-400">{status.message}</p>
      )}
    </div>
  );
}
