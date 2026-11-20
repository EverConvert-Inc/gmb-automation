import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { getPacingOverview, type PacingRow } from "@/lib/queries-google-ads-pacing";
import { firstOfMonthIsoEastern } from "@/lib/date-utils";
import { money0 } from "@/lib/google-ads-format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Google Ads — Pacing" };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function monthLabel(monthStart: string): string {
  const [y, m] = monthStart.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

const pacePct = (p: number | null) => (p === null ? "—" : `${Math.round(p * 100)}%`);
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${money0(Math.abs(n))}`;

const TH = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground";
const THR = "px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground";
const TD = "px-3 py-2";
const TDR = "px-3 py-2 text-right tabular-nums";

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function StatusCell({ row }: { row: PacingRow }) {
  if (row.status === "no_budget") return <span className="text-xs text-muted-foreground">No budget set</span>;
  if (row.status === "hot")
    return (
      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
        Hot
      </span>
    );
  return <span className="text-xs text-muted-foreground">{row.status === "cold" ? "Under" : "On track"}</span>;
}

export default async function GoogleAdsPacingPage() {
  const monthStart = firstOfMonthIsoEastern();
  const data = await getPacingOverview(monthStart);
  const { totals } = data;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Google Ads</div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Pacing</h1>
        </div>
        <div className="text-sm text-muted-foreground">
          {monthLabel(monthStart)} · day {data.daysElapsed} of {data.daysInMonth}
        </div>
      </header>

      {data.rows.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No pacing data for this month yet. The account-health sync populates it daily.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
            <Kpi label="Monthly budget" value={money0(totals.monthlyBudget)} />
            <Kpi
              label="Spent (MTD)"
              value={money0(totals.spend)}
              sub={totals.monthlyBudget > 0 ? `${Math.round((totals.spend / totals.monthlyBudget) * 100)}% of budget` : undefined}
            />
            <Kpi label="Pace" value={pacePct(totals.pace)} sub={`${totals.hot} hot · ${totals.cold} under`} />
            <Kpi
              label="Projected"
              value={money0(totals.projected)}
              sub={totals.monthlyBudget > 0 ? `${signed(totals.projected - totals.monthlyBudget)} vs budget` : undefined}
            />
            <Kpi label="Needed / day" value={money0(totals.neededPerDay)} sub={`over ${Math.max(0, data.daysInMonth - data.daysElapsed)} days left`} />
          </div>

          <Card>
            <CardContent className="p-0">
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
                    {data.rows.map((r) => (
                      <tr key={r.clientId} className="hover:bg-muted/40">
                        <td className={cn(TD, "pl-4 font-medium")}>{r.name}</td>
                        <td className={TDR}>{r.monthlyBudget === null ? "—" : money0(r.monthlyBudget)}</td>
                        <td className={TDR}>{money0(r.spend)}</td>
                        <td className={cn(TDR, r.status === "hot" && "font-semibold text-amber-700 dark:text-amber-400")}>
                          {pacePct(r.pace)}
                        </td>
                        <td className={TDR}>{r.projected === null ? "—" : money0(r.projected)}</td>
                        <td className={cn(TDR, "text-muted-foreground")}>{r.vsBudget === null ? "—" : signed(r.vsBudget)}</td>
                        <td className={TDR}>{r.neededPerDay === null ? "—" : money0(r.neededPerDay)}</td>
                        <td className={cn(TD, "pr-4")}>
                          <StatusCell row={r} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            Account-level, from the daily account-health snapshots. Budget is the daily budget × days in the month; pace is
            spend against the expected run-rate so far; projected extends the current run-rate to month end. Per-campaign
            pacing needs per-campaign budgets (a later add).
          </p>
        </>
      )}
    </div>
  );
}
