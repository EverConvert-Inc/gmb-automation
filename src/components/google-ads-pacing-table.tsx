"use client";

import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PacingRow, PacingStatus } from "@/lib/queries-google-ads-pacing";
import type { CampaignPacingRow } from "@/lib/queries-ads-dashboard";
import { enumLabel, money0, pacePct, signedMoney } from "@/lib/google-ads-format";

const TH = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground";
const THR = "px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground";
const TD = "px-3 py-2";
const TDR = "px-3 py-2 text-right tabular-nums";
const SPAN = 7; // columns after the Account cell

type PacingLike = {
  monthlyBudget: number | null;
  spend: number;
  pace: number | null;
  projected: number | null;
  vsBudget: number | null;
  neededPerDay: number | null;
  status: PacingStatus;
};

function StatusCell({ status }: { status: PacingStatus }) {
  if (status === "no_budget") return <span className="text-xs text-muted-foreground">No budget set</span>;
  if (status === "hot")
    return (
      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
        Hot
      </span>
    );
  return <span className="text-xs text-muted-foreground">{status === "cold" ? "Under" : "On track"}</span>;
}

function PacingCells({ p }: { p: PacingLike }) {
  return (
    <>
      <td className={TDR}>{p.monthlyBudget === null ? "—" : money0(p.monthlyBudget)}</td>
      <td className={TDR}>{money0(p.spend)}</td>
      <td className={cn(TDR, p.status === "hot" && "font-semibold text-amber-700 dark:text-amber-400")}>{pacePct(p.pace)}</td>
      <td className={TDR}>{p.projected === null ? "—" : money0(p.projected)}</td>
      <td className={cn(TDR, "text-muted-foreground")}>{p.vsBudget === null ? "—" : signedMoney(p.vsBudget)}</td>
      <td className={TDR}>{p.neededPerDay === null ? "—" : money0(p.neededPerDay)}</td>
      <td className={cn(TD, "pr-4")}>
        <StatusCell status={p.status} />
      </td>
    </>
  );
}

type Breakdown =
  | { state: "loading" }
  | { state: "error"; error: string }
  | { state: "done"; campaigns: CampaignPacingRow[] };

export function GoogleAdsPacingTable({ rows, monthStart }: { rows: PacingRow[]; monthStart: string }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [breakdowns, setBreakdowns] = useState<Record<string, Breakdown>>({});

  async function toggle(r: PacingRow) {
    const willOpen = !open.has(r.clientId);
    setOpen((prev) => {
      const next = new Set(prev);
      if (willOpen) next.add(r.clientId);
      else next.delete(r.clientId);
      return next;
    });
    if (!willOpen || breakdowns[r.clientId]) return;

    setBreakdowns((p) => ({ ...p, [r.clientId]: { state: "loading" } }));
    try {
      const q = new URLSearchParams({ clientId: r.clientId, monthStart });
      const res = await fetch(`/api/ads/pacing-breakdown?${q.toString()}`);
      const json = (await res.json()) as { campaigns?: CampaignPacingRow[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to load campaigns");
      setBreakdowns((p) => ({ ...p, [r.clientId]: { state: "done", campaigns: json.campaigns ?? [] } }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setBreakdowns((p) => ({ ...p, [r.clientId]: { state: "error", error: msg } }));
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b">
          <tr>
            <th className={cn(TH, "pl-4")}>Account</th>
            <th className={THR}>Budget</th>
            <th className={THR}>Spent</th>
            <th className={THR}>Pace</th>
            <th className={THR}>Projected</th>
            <th className={THR}>vs budget</th>
            <th className={THR}>Needed / day</th>
            <th className={cn(TH, "pr-4")}>Status</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => {
            const isOpen = open.has(r.clientId);
            const d = breakdowns[r.clientId];
            return (
              <Fragment key={r.clientId}>
                <tr className="cursor-pointer hover:bg-muted/40" onClick={() => toggle(r)}>
                  <td className={cn(TD, "pl-4 font-medium")}>
                    <span className="inline-flex items-center gap-1.5">
                      <ChevronRight
                        className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")}
                      />
                      {r.name}
                    </span>
                  </td>
                  <PacingCells p={r} />
                </tr>

                {isOpen && d?.state === "loading" && (
                  <tr className="bg-muted/20">
                    <td className={TD} />
                    <td colSpan={SPAN} className="px-3 py-2 pl-10 text-xs text-muted-foreground">
                      Loading campaigns…
                    </td>
                  </tr>
                )}
                {isOpen && d?.state === "error" && (
                  <tr className="bg-muted/20">
                    <td className={TD} />
                    <td colSpan={SPAN} className="px-3 py-2 pl-10 text-xs text-red-700 dark:text-red-400">
                      {d.error}
                    </td>
                  </tr>
                )}
                {isOpen && d?.state === "done" && d.campaigns.length === 0 && (
                  <tr className="bg-muted/20">
                    <td className={TD} />
                    <td colSpan={SPAN} className="px-3 py-2 pl-10 text-xs text-muted-foreground">
                      No campaigns with spend or an active budget this month.
                    </td>
                  </tr>
                )}
                {isOpen &&
                  d?.state === "done" &&
                  d.campaigns.map((c) => (
                    <tr key={c.campaignId} className="bg-muted/10">
                      <td className={cn(TD, "pl-10")}>
                        <span>{c.name}</span>
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {enumLabel(c.type)}
                          {c.shared && " · shared"}
                        </span>
                      </td>
                      <PacingCells p={c} />
                    </tr>
                  ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <p className="px-4 py-2 text-xs text-muted-foreground">
        Click an account to expand its campaigns (budgets pulled live; shared budgets are marked).
      </p>
    </div>
  );
}
