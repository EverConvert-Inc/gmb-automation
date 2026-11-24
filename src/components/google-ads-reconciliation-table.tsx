"use client";

import { Fragment, useCallback, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { RECON_SOURCES, type ReconRow, type ReconStatus, type ReconSummary } from "@/lib/ads-reconciliation";
import { ReconciliationMappingsManager } from "./google-ads-reconciliation-mappings-manager";

const TH = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground";
const TD = "px-3 py-2";
const COLS = 6;

function sourceLabel(source: ReconRow["source"]): string {
  return RECON_SOURCES.find((s) => s.value === source)?.label ?? source;
}

function StatusBadge({ status }: { status: ReconStatus }) {
  const map: Record<ReconStatus, [string, string]> = {
    match: ["bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", "Match"],
    watch: ["bg-amber-500/10 text-amber-700 dark:text-amber-400", "Watch"],
    mismatch: ["bg-red-500/10 text-red-700 dark:text-red-400", "Mismatch"],
  };
  const [cls, label] = map[status];
  return <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide", cls)}>{label}</span>;
}

function delta(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

type Breakdown =
  | { state: "loading" }
  | { state: "error"; error: string }
  | { state: "done"; rows: ReconRow[]; summary: ReconSummary; formError: string | null };

export function GoogleAdsReconciliationTable({
  accounts,
  from,
  to,
}: {
  accounts: Array<{ id: string; name: string }>;
  from: string;
  to: string;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [configuring, setConfiguring] = useState<Set<string>>(new Set());
  const [data, setData] = useState<Record<string, Breakdown>>({});

  const load = useCallback(
    async (id: string) => {
      setData((p) => ({ ...p, [id]: { state: "loading" } }));
      try {
        const res = await fetch(
          `/api/ads/reconciliation?clientId=${encodeURIComponent(id)}&from=${from}&to=${to}`,
        );
        const json = (await res.json()) as {
          rows?: ReconRow[];
          summary?: ReconSummary;
          formError?: string | null;
          error?: string;
        };
        if (!res.ok) throw new Error(json.error ?? "Failed to load");
        setData((p) => ({
          ...p,
          [id]: {
            state: "done",
            rows: json.rows ?? [],
            summary: json.summary ?? { mapped: 0, match: 0, watch: 0, mismatch: 0 },
            formError: json.formError ?? null,
          },
        }));
      } catch (e) {
        setData((p) => ({ ...p, [id]: { state: "error", error: e instanceof Error ? e.message : String(e) } }));
      }
    },
    [from, to],
  );

  async function toggle(id: string) {
    const willOpen = !open.has(id);
    setOpen((prev) => {
      const next = new Set(prev);
      if (willOpen) next.add(id);
      else next.delete(id);
      return next;
    });
    if (willOpen && !data[id]) await load(id);
  }

  function toggleConfigure(id: string) {
    setConfiguring((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b">
          <tr>
            <th className={cn(TH, "pl-4")}>Metric</th>
            <th className={cn(TH, "text-right")}>Google Ads</th>
            <th className={TH}>Compared against</th>
            <th className={cn(TH, "text-right")}>CallRail</th>
            <th className={cn(TH, "text-right")}>Δ</th>
            <th className={cn(TH, "pr-4")}>Status</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {accounts.map((a) => {
            const isOpen = open.has(a.id);
            const d = data[a.id];
            const isConfiguring = configuring.has(a.id);
            return (
              <Fragment key={a.id}>
                <tr className="cursor-pointer bg-muted/20 hover:bg-muted/40" onClick={() => toggle(a.id)}>
                  <td colSpan={COLS} className={cn(TD, "pl-4 font-medium")}>
                    <span className="inline-flex items-center gap-2">
                      <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
                      {a.name}
                      {d?.state === "done" && (
                        <span className="text-xs font-normal text-muted-foreground">
                          {d.summary.mapped === 0
                            ? "· no mappings yet"
                            : `· ${d.summary.mapped} mapped · ${d.summary.match} match · ${d.summary.watch} watch · ${d.summary.mismatch} mismatch`}
                        </span>
                      )}
                    </span>
                  </td>
                </tr>

                {isOpen && d?.state === "loading" && (
                  <tr><td colSpan={COLS} className="px-3 py-2 pl-10 text-xs text-muted-foreground">Loading…</td></tr>
                )}
                {isOpen && d?.state === "error" && (
                  <tr><td colSpan={COLS} className="px-3 py-2 pl-10 text-xs text-red-700 dark:text-red-400">{d.error}</td></tr>
                )}

                {isOpen && d?.state === "done" && (
                  <>
                    {d.rows.map((r) => (
                      <tr key={r.id} className="hover:bg-muted/30">
                        <td className={cn(TD, "pl-10")}>
                          <span className="font-medium">{r.label}</span>
                          <span className="ml-2 text-xs text-muted-foreground">
                            {r.adsConversionActionName || r.adsConversionActionId}
                          </span>
                        </td>
                        <td className={cn(TD, "text-right tabular-nums")}>{r.adsCount}</td>
                        <td className={cn(TD, "text-muted-foreground")}>{sourceLabel(r.source)}</td>
                        <td className={cn(TD, "text-right tabular-nums")}>{r.sourceCount}</td>
                        <td className={cn(TD, "text-right tabular-nums")}>
                          {delta(r.delta)}
                          {r.diffPct !== null && (
                            <span className="ml-1 text-xs text-muted-foreground">({Math.round(r.diffPct * 100)}%)</span>
                          )}
                        </td>
                        <td className={cn(TD, "pr-4")}><StatusBadge status={r.status} /></td>
                      </tr>
                    ))}

                    {d.formError && (
                      <tr>
                        <td colSpan={COLS} className="px-3 py-2 pl-10 text-xs text-amber-700 dark:text-amber-400">
                          {d.formError}
                        </td>
                      </tr>
                    )}

                    {d.rows.length === 0 && (
                      <tr>
                        <td colSpan={COLS} className="px-3 py-2 pl-10 text-xs text-muted-foreground">
                          No mappings yet — add one below to compare this account&apos;s conversion counts against CallRail.
                        </td>
                      </tr>
                    )}

                    <tr className="bg-muted/10">
                      <td colSpan={COLS} className="px-3 py-2 pl-10">
                        <button
                          onClick={() => toggleConfigure(a.id)}
                          className="text-xs font-medium text-muted-foreground underline hover:text-foreground"
                        >
                          {isConfiguring ? "Hide mapping setup" : "Configure mappings"}
                        </button>
                        {isConfiguring && (
                          <div className="mt-2 max-w-3xl">
                            <ReconciliationMappingsManager clientId={a.id} onChanged={() => load(a.id)} />
                          </div>
                        )}
                      </td>
                    </tr>
                  </>
                )}
              </Fragment>
            );
          })}
          {accounts.length === 0 && (
            <tr>
              <td colSpan={COLS} className="px-4 py-8 text-center text-sm text-muted-foreground">
                No Google Ads accounts linked.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
