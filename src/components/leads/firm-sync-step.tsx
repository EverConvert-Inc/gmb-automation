"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FirmButton } from "./firm-button";
import { fuGreenText } from "./firm-ui";

/**
 * The existing staff sync route, narrowed to this firm's companies, with
 * text conversations included (texts=1) — calls, forms and texts, the same
 * as the scheduled run.
 */
export function firmSyncUrl(companyIds: readonly string[]): string {
  return `/api/admin/leads/sync-now?companyIds=${encodeURIComponent(companyIds.join(","))}&texts=1`;
}

type SourceSummary = { fetched: number; written: number; parseFailed: number; error: string | null };
/** texts is null when the run did not include texts. */
type Summary = { calls: SourceSummary; forms: SourceSummary; texts?: SourceSummary | null };

const line = (fetched: number, written: number, failed: number) =>
  `${fetched} fetched · ${written} written · ${failed} couldn't be read`;

export function summarise(s: Summary): string {
  const calls = line(
    s.calls.fetched + s.forms.fetched,
    s.calls.written + s.forms.written,
    s.calls.parseFailed + s.forms.parseFailed,
  );
  if (!s.texts) return calls;
  return `${calls} · Texts: ${line(s.texts.fetched, s.texts.written, s.texts.parseFailed)}`;
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
      setResult({ calls: body.calls, forms: body.forms, texts: body.texts ?? null });
      startRefresh(() => router.refresh());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const sourceError = result ? (result.calls.error ?? result.forms.error ?? result.texts?.error ?? null) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <FirmButton variant="primary" onClick={sync} disabled={busy || companyIds.length === 0}>
          {busy ? "Syncing… (can take a minute)" : "Sync now"}
        </FirmButton>
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
