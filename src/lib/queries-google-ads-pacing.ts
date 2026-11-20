import { asc, eq } from "drizzle-orm";
import { db } from "./db/client";
import { ppcAccountHealthDaily, ppcClients } from "./db/schema";

// Read side of Google Ads Pacing (/ads/pacing): per-account budget vs spend
// for a calendar month, from the stored ppc_account_health_daily snapshots the
// account-health sync already writes. Per-campaign pacing (the expandable
// drill-down) lives in queries-ads-dashboard.ts (it needs live campaign
// budgets) but reuses computePacing below so both levels agree.

export type PacingStatus = "hot" | "on_track" | "cold" | "no_budget" | "no_data";

export type Pacing = {
  monthlyBudget: number | null; // daily budget × days in month
  pace: number | null; // spend ÷ expected-by-now
  projected: number | null; // run-rate to month end
  vsBudget: number | null; // projected − monthly budget
  neededPerDay: number | null; // to land exactly on budget over the days left
  status: PacingStatus;
};

export type PacingRow = Pacing & {
  clientId: string;
  name: string;
  spend: number; // month to date
  asOf: string | null; // date of the snapshot these numbers came from
};

export type PacingTotals = {
  monthlyBudget: number;
  spend: number;
  pace: number | null;
  projected: number;
  neededPerDay: number;
  hot: number;
  cold: number;
};

export type PacingOverview = {
  monthStart: string;
  daysInMonth: number;
  daysElapsed: number; // from the newest snapshot in the month
  rows: PacingRow[];
  totals: PacingTotals;
};

// Over budget at ≥110% of the expected run-rate, under at ≤85%.
const HOT = 1.1;
const COLD = 0.85;

const micros = (v: bigint | string | number | null) => Number(v ?? 0) / 1_000_000;

export function daysInMonthOf(monthStart: string): number {
  const [y, m] = monthStart.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// The one pacing calc, shared by the account and campaign levels.
export function computePacing(
  dailyBudget: number,
  spend: number,
  daysElapsed: number,
  daysInMonth: number,
): Pacing {
  const elapsed = Math.min(Math.max(daysElapsed, 0), daysInMonth);
  const remaining = Math.max(0, daysInMonth - elapsed);
  const projected = elapsed > 0 ? (spend / elapsed) * daysInMonth : null;
  if (dailyBudget <= 0) {
    return { monthlyBudget: null, pace: null, projected, vsBudget: null, neededPerDay: null, status: "no_budget" };
  }
  const monthlyBudget = dailyBudget * daysInMonth;
  const expectedByNow = dailyBudget * elapsed;
  const pace = expectedByNow > 0 ? spend / expectedByNow : null;
  const neededPerDay = remaining > 0 ? Math.max(0, monthlyBudget - spend) / remaining : 0;
  const status: PacingStatus =
    pace === null ? "on_track" : pace >= HOT ? "hot" : pace <= COLD ? "cold" : "on_track";
  return {
    monthlyBudget,
    pace,
    projected,
    vsBudget: projected !== null ? projected - monthlyBudget : null,
    neededPerDay,
    status,
  };
}

export async function getPacingOverview(monthStart: string): Promise<PacingOverview> {
  const daysInMonth = daysInMonthOf(monthStart);

  const snapshots = await db
    .select({
      clientId: ppcAccountHealthDaily.ppcClientId,
      name: ppcClients.name,
      date: ppcAccountHealthDaily.date,
      dailyBudgetMicros: ppcAccountHealthDaily.dailyBudgetMicros,
      mtdSpendMicros: ppcAccountHealthDaily.mtdSpendMicros,
    })
    .from(ppcAccountHealthDaily)
    .innerJoin(ppcClients, eq(ppcAccountHealthDaily.ppcClientId, ppcClients.id))
    .where(eq(ppcAccountHealthDaily.monthStart, monthStart))
    .orderBy(asc(ppcAccountHealthDaily.date));

  // Newest snapshot per account (ascending order → last write wins).
  const latest = new Map<string, (typeof snapshots)[number]>();
  for (const s of snapshots) latest.set(s.clientId, s);

  const newestDate = snapshots.length ? snapshots[snapshots.length - 1].date : null;
  const daysElapsed = newestDate ? Number(newestDate.split("-")[2]) : 0;

  const rows: PacingRow[] = [...latest.values()]
    .map((s): PacingRow => {
      const spend = micros(s.mtdSpendMicros);
      const p = computePacing(micros(s.dailyBudgetMicros), spend, Number(s.date.split("-")[2]), daysInMonth);
      return { clientId: s.clientId, name: s.name, spend, asOf: s.date, ...p };
    })
    .sort((a, b) => b.spend - a.spend);

  const budgeted = rows.filter((r) => r.monthlyBudget !== null);
  const totalBudget = budgeted.reduce((n, r) => n + (r.monthlyBudget ?? 0), 0);
  const totalSpend = rows.reduce((n, r) => n + r.spend, 0);
  const totalProjected = rows.reduce((n, r) => n + (r.projected ?? 0), 0);
  const totalNeeded = budgeted.reduce((n, r) => n + (r.neededPerDay ?? 0), 0);
  const expectedByNow = daysInMonth > 0 ? totalBudget * (daysElapsed / daysInMonth) : 0;

  return {
    monthStart,
    daysInMonth,
    daysElapsed,
    rows,
    totals: {
      monthlyBudget: totalBudget,
      spend: totalSpend,
      pace: expectedByNow > 0 ? totalSpend / expectedByNow : null,
      projected: totalProjected,
      neededPerDay: totalNeeded,
      hot: rows.filter((r) => r.status === "hot").length,
      cold: rows.filter((r) => r.status === "cold").length,
    },
  };
}
