"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type SyncAllResponse = {
  locationsProcessed?: number;
  ingested?: number;
  performanceRows?: number;
  errors?: Array<{ locationName: string; error: string }>;
  error?: string;
};

export function SyncAllLocationsButton({
  clientId,
  connectedCount,
}: {
  clientId: string;
  connectedCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pendingRefresh, startRefresh] = useTransition();

  async function run() {
    setBusy(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/sync-all`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as SyncAllResponse;
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);

      const locs = body.locationsProcessed ?? 0;
      const ingested = body.ingested ?? 0;
      const perfRows = body.performanceRows ?? 0;
      const errs = body.errors ?? [];

      if (locs === 0) {
        toast.info("No locations have GBP connected yet.");
      } else {
        const parts: string[] = [
          `${locs} location${locs === 1 ? "" : "s"}`,
          ingested > 0
            ? `${ingested} new review${ingested === 1 ? "" : "s"}`
            : "no new reviews",
        ];
        if (perfRows > 0) {
          parts.push(`${perfRows} performance row${perfRows === 1 ? "" : "s"}`);
        }
        if (errs.length === 0) {
          toast.success(parts.join(" · "));
        } else {
          // Build a multi-line message: summary + per-location errors. Sonner
          // renders \n correctly in its toast body.
          const detail = errs
            .map((e) => `${e.locationName}: ${e.error}`)
            .join("\n");
          toast.warning(`${parts.join(" · ")} · ${errs.length} errored`, {
            description: detail,
            duration: 10_000,
          });
        }
      }
      startRefresh(() => router.refresh());
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const noneConnected = connectedCount === 0;

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={run}
      disabled={busy || pendingRefresh || noneConnected}
      title={
        noneConnected
          ? "No locations have Google Business Profile connected yet. Click \"Connect Google Business Profile\" on any location to enable syncing."
          : undefined
      }
    >
      {busy ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
      )}
      {busy
        ? "Syncing all locations…"
        : noneConnected
          ? "Sync all locations · GBP not connected"
          : "Sync all locations"}
    </Button>
  );
}
