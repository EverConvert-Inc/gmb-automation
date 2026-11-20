import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { GoogleAdsPacingTable } from "@/components/google-ads-pacing-table";
import { getPacingOverview } from "@/lib/queries-google-ads-pacing";
import { firstOfMonthIsoEastern } from "@/lib/date-utils";
import { money0, pacePct, signedMoney } from "@/lib/google-ads-format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Google Ads — Pacing" };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function monthLabel(monthStart: string): string {
  const [y, m] = monthStart.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

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
              sub={totals.monthlyBudget > 0 ? `${signedMoney(totals.projected - totals.monthlyBudget)} vs budget` : undefined}
            />
            <Kpi label="Needed / day" value={money0(totals.neededPerDay)} sub={`over ${Math.max(0, data.daysInMonth - data.daysElapsed)} days left`} />
          </div>

          <Card>
            <CardContent className="p-0">
              <GoogleAdsPacingTable rows={data.rows} monthStart={monthStart} />
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            Account-level from the daily account-health snapshots; expand an account for its campaigns (budgets pulled live).
            Budget is the daily budget × days in the month; pace is spend against the expected run-rate so far; projected
            extends the current run-rate to month end.
          </p>
        </>
      )}
    </div>
  );
}
