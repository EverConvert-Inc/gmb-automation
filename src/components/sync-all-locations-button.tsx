"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type SyncAllResponse = {
  locationsProcessed?: number;
  ingested?: number;
  performanceRows?: number;
  errors?: Array<{ locationName: string; error: string }>;
  error?: string;
};

export function SyncAllLocationsButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pendingRefresh, startRefresh] = useTransition();
  const [okMessage, setOkMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [perLocErrors, setPerLocErrors] = useState<
    Array<{ locationName: string; error: string }>
  >([]);

  async function run() {
    setBusy(true);
    setOkMessage(null);
    setErrorMessage(null);
    setPerLocErrors([]);
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
        setOkMessage("No locations have GBP connected yet");
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
        setOkMessage(parts.join(" · "));
      }
      setPerLocErrors(errs);
      startRefresh(() => router.refresh());
    } catch (err) {
      setErrorMessage((err as Error).message);
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
        {busy ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
        )}
        {busy ? "Syncing all locations…" : "Sync all locations"}
      </Button>
      {okMessage && <span className="text-xs text-green-700">{okMessage}</span>}
      {errorMessage && <span className="text-xs text-red-600">{errorMessage}</span>}
      {perLocErrors.length > 0 && (
        <ul className="mt-1 max-w-xs space-y-0.5 text-right text-[11px] text-amber-700">
          {perLocErrors.map((e, i) => (
            <li key={i}>
              <span className="font-medium">{e.locationName}:</span> {e.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
