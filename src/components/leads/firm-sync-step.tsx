"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { fuGreenText, fuPrimary } from "./firm-ui";

/** The existing staff sync route, narrowed to this firm's companies. */
export function firmSyncUrl(companyIds: readonly string[]): string {
  return `/api/admin/leads/sync-now?companyIds=${encodeURIComponent(companyIds.join(","))}`;
}

type SourceSummary = { fetched: number; written: number; parseFailed: number; error: string | null };
type Summary = { calls: SourceSummary; forms: SourceSummary };

export function summarise(s: Summary): string {
  const fetched = s.calls.fetched + s.forms.fetched;
  const written = s.calls.written + s.forms.written;
  const failed = s.calls.parseFailed + s.forms.parseFailed;
  return `${fetched} fetched · ${written} written · ${failed} couldn't be read`;
}

/** Step 3: run the sync for this firm's companies now, and see the result. */
export function FirmSyncStep({
  firmId,
  companyIds,
  queueCount,
}: {
  firmId: string;
  companyIds: string[];
  queueCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startRefresh] = useTransition();

  async function sync() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(firmSyncUrl(companyIds), { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as Partial<Summary> & { error?: string };
      if (!body.calls || !body.forms) throw new Error(body.error ?? `HTTP ${res.status}`);
      setResult({ calls: body.calls, forms: body.forms });
      startRefresh(() => router.refresh());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const sourceError = result ? (result.calls.error ?? result.forms.error) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" className={fuPrimary} onClick={sync} disabled={busy || companyIds.length === 0}>
          {busy ? "Syncing… (can take a minute)" : "Sync now"}
        </Button>
        {companyIds.length === 0 && <span className="text-sm text-muted-foreground">Map a CallRail company first.</span>}
        {result && !busy && (
          <span role="status" className="text-sm text-muted-foreground" data-sync-summary>
            {summarise(result)}
          </span>
        )}
      </div>
      {(error || sourceError) && (
        <p role="alert" className="text-sm text-destructive">
          {error ?? sourceError}
        </p>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link href={`/admin/leads?firm=${encodeURIComponent(firmId)}`} className={`${fuGreenText} font-medium hover:underline`}>
          View this firm&apos;s leads →
        </Link>
        <Link href="/admin/leads/queue" className="text-muted-foreground hover:underline">
          Admin queue ({queueCount}) →
        </Link>
      </div>
    </div>
  );
}
