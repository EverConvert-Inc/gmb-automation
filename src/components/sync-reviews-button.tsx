"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

export function SyncReviewsButton({ locationId }: { locationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pendingRefresh, startRefresh] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setOkMessage(null);
    try {
      const res = await fetch(`/api/locations/${locationId}/sync-reviews`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as {
        ingested?: number;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setOkMessage(
        body.ingested === 0
          ? "No new reviews from Google."
          : `Synced ${body.ingested} review${body.ingested === 1 ? "" : "s"}.`,
      );
      startRefresh(() => router.refresh());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={run}
        disabled={busy || pendingRefresh}
      >
        <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
        {busy ? "Syncing…" : "Sync reviews"}
      </Button>
      {okMessage && <span className="text-xs text-green-700">{okMessage}</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
