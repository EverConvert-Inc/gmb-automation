"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronRight, Download, Search } from "lucide-react";
import { AdminSelect } from "@/components/leads/admin-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { downloadCsv, toCsv } from "@/lib/csv";
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

const STATUS_FILTERS: Array<{ value: "all" | PacingStatus; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "hot", label: "Hot" },
  { value: "cold", label: "Under" },
  { value: "on_track", label: "On track" },
  { value: "no_budget", label: "No budget set" },
];

const STATUS_LABEL: Record<PacingStatus, string> = {
  hot: "Hot",
  cold: "Under",
  on_track: "On track",
  no_budget: "No budget set",
  no_data: "No data",
};

// Raw numbers (2 dp), not display strings, so the sheet can sum them.
const r2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);

function exportCsv(rows: PacingRow[], monthStart: string) {
  const csv = toCsv(
    ["Account", "Monthly budget", "Spent MTD", "Pace %", "Projected", "Projected vs budget", "Needed per day", "Status", "As of"],
    rows.map((r) => [
      r.name,
      r2(r.monthlyBudget),
      r2(r.spend),
      r.pace === null ? null : Math.round(r.pace * 1000) / 10,
      r2(r.projected),
      r2(r.vsBudget),
      r2(r.neededPerDay),
      STATUS_LABEL[r.status],
      r.asOf,
    ]),
  );
  downloadCsv(`google-ads-pacing-${monthStart.slice(0, 7)}.csv`, csv);
}

type Breakdown =
  | { state: "loading" }
  | { state: "error"; error: string }
  | { state: "done"; campaigns: CampaignPacingRow[] };

export function GoogleAdsPacingTable({ rows, monthStart }: { rows: PacingRow[]; monthStart: string }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [breakdowns, setBreakdowns] = useState<Record<string, Breakdown>>({});
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | PacingStatus>("all");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) => (statusFilter === "all" || r.status === statusFilter) && (!q || r.name.toLowerCase().includes(q)),
    );
  }, [rows, query, statusFilter]);

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
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <div className="relative w-full sm:w-64">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search accounts"
            aria-label="Search accounts"
            className="pl-8"
          />
        </div>
        <div className="w-full sm:w-44">
          <AdminSelect
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | PacingStatus)}
            aria-label="Filter by status"
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </AdminSelect>
        </div>
        <span className="text-xs text-muted-foreground">
          {visible.length === rows.length ? `${rows.length} accounts` : `${visible.length} of ${rows.length} accounts`}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto gap-1.5"
          onClick={() => exportCsv(visible, monthStart)}
          disabled={visible.length === 0}
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </Button>
      </div>
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
          {visible.length === 0 && (
            <tr>
              <td colSpan={SPAN + 1} className="px-4 py-6 text-center text-sm text-muted-foreground">
                No accounts match.
              </td>
            </tr>
          )}
          {visible.map((r) => {
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
      </div>
      <p className="px-4 py-2 text-xs text-muted-foreground">
        Click an account to expand its campaigns (budgets pulled live; shared budgets are marked). Export covers the
        accounts shown.
      </p>
    </div>
  );
}
