"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

type Variant = "default" | "compact";

export function SyncReviewsButton({
  locationId,
  variant = "default",
  label,
}: {
  locationId: string;
  variant?: Variant;
  label?: string;
}) {
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
        performanceRows?: number;
        performanceError?: string | null;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const parts: string[] = [];
      if (body.ingested && body.ingested > 0) {
        parts.push(`${body.ingested} new review${body.ingested === 1 ? "" : "s"}`);
      } else {
        parts.push("No new reviews");
      }
      if (body.performanceRows && body.performanceRows > 0) {
        parts.push(`${body.performanceRows} performance row${body.performanceRows === 1 ? "" : "s"}`);
      } else if (body.performanceError) {
        parts.push("performance not ready");
      }
      setOkMessage(parts.join(" · "));
      startRefresh(() => router.refresh());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const buttonLabel = busy ? "Syncing…" : label ?? "Sync now";

  if (variant === "compact") {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={run}
        disabled={busy || pendingRefresh}
      >
        <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
        {buttonLabel}
      </Button>
    );
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
        {buttonLabel}
      </Button>
      {okMessage && <span className="text-xs text-green-700">{okMessage}</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
