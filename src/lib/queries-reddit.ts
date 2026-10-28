import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "./db/client";
import { redditAdAccounts, redditAdsDaily, redditClients } from "./db/schema";
import { addDaysIso, datesInRange } from "./reddit-sync";

// Read side of the Reddit Ads spend report. Nothing here reads PPC/LSA.

export const UNMAPPED_KEY = "unmapped";

export type RedditReportAccount = {
  id: string;
  name: string;
  currency: string | null;
  isActive: boolean;
  redditClientId: string | null;
  redditClientName: string | null;
  lastSyncAt: Date | null;
  lastSyncError: string | null;
};

export type RedditSpendRow = { adAccountId: string; date: string; spendMicros: bigint };

export type RedditClientSpend = {
  key: string; // client id, or UNMAPPED_KEY
  name: string;
  accountCount: number;
  totalMicros: bigint;
  byDate: Record<string, bigint>;
};

export type RedditReport = {
  from: string;
  to: string;
  dates: string[]; // newest first
  clients: RedditClientSpend[]; // by spend, highest first; Unmapped last
  dailyTotals: Record<string, bigint>;
  totalMicros: bigint;
  priorTotalMicros: bigint;
  activeAccountCount: number;
  unmappedAccountCount: number;
  // Non-USD (or currency-unknown) accounts: still synced, shown here,
  // never added into any total.
  excludedAccounts: Array<{ name: string; currency: string | null }>;
  failingAccounts: Array<{ name: string; error: string }>;
  lastSyncAt: Date | null;
};

export const isUsd = (a: { currency: string | null }) => a.currency === "USD";

export function buildRedditReport(input: {
  from: string;
  to: string;
  accounts: RedditReportAccount[];
  rows: RedditSpendRow[];
  priorTotalMicros: bigint;
}): RedditReport {
  const { from, to, accounts, rows, priorTotalMicros } = input;
  const dates = datesInRange(from, to).reverse();
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const groups = new Map<string, RedditClientSpend>();
  const group = (a: RedditReportAccount): RedditClientSpend => {
    const key = a.redditClientId ?? UNMAPPED_KEY;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        name: a.redditClientName ?? "Unmapped",
        accountCount: 0,
        totalMicros: 0n,
        byDate: {},
      };
      groups.set(key, g);
    }
    return g;
  };

  // Every active USD account's client gets a row, even at zero spend, so
  // "no spend this period" is visible rather than a missing row.
  for (const a of accounts) {
    if (a.isActive && isUsd(a)) group(a).accountCount += 1;
  }

  const dailyTotals: Record<string, bigint> = {};
  let totalMicros = 0n;
  for (const r of rows) {
    const a = accountById.get(r.adAccountId);
    if (!a || !isUsd(a)) continue;
    const g = group(a);
    g.totalMicros += r.spendMicros;
    g.byDate[r.date] = (g.byDate[r.date] ?? 0n) + r.spendMicros;
    dailyTotals[r.date] = (dailyTotals[r.date] ?? 0n) + r.spendMicros;
    totalMicros += r.spendMicros;
  }

  const clients = [...groups.values()].sort((x, y) => {
    if (x.key === UNMAPPED_KEY) return 1;
    if (y.key === UNMAPPED_KEY) return -1;
    if (x.totalMicros !== y.totalMicros) return x.totalMicros > y.totalMicros ? -1 : 1;
    return x.name.localeCompare(y.name);
  });

  const active = accounts.filter((a) => a.isActive);
  const syncTimes = active.map((a) => a.lastSyncAt?.getTime() ?? 0).filter(Boolean);
  return {
    from,
    to,
    dates,
    clients,
    dailyTotals,
    totalMicros,
    priorTotalMicros,
    activeAccountCount: active.length,
    unmappedAccountCount: active.filter((a) => !a.redditClientId).length,
    excludedAccounts: accounts
      .filter((a) => !isUsd(a))
      .map((a) => ({ name: a.name, currency: a.currency })),
    failingAccounts: active
      .filter((a) => a.lastSyncError)
      .map((a) => ({ name: a.name, error: a.lastSyncError as string })),
    lastSyncAt: syncTimes.length ? new Date(Math.max(...syncTimes)) : null,
  };
}

export async function listRedditReportAccounts(): Promise<RedditReportAccount[]> {
  return db
    .select({
      id: redditAdAccounts.id,
      name: redditAdAccounts.name,
      currency: redditAdAccounts.currency,
      isActive: redditAdAccounts.isActive,
      redditClientId: redditAdAccounts.redditClientId,
      redditClientName: redditClients.name,
      lastSyncAt: redditAdAccounts.lastSyncAt,
      lastSyncError: redditAdAccounts.lastSyncError,
    })
    .from(redditAdAccounts)
    .leftJoin(redditClients, eq(redditAdAccounts.redditClientId, redditClients.id))
    .orderBy(asc(redditAdAccounts.name));
}

async function spendRows(from: string, to: string): Promise<RedditSpendRow[]> {
  return db
    .select({
      adAccountId: redditAdsDaily.adAccountId,
      date: redditAdsDaily.date,
      spendMicros: redditAdsDaily.spendMicros,
    })
    .from(redditAdsDaily)
    .where(and(gte(redditAdsDaily.date, from), lte(redditAdsDaily.date, to)));
}

async function usdTotalMicros(from: string, to: string): Promise<bigint> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${redditAdsDaily.spendMicros}), 0)::text` })
    .from(redditAdsDaily)
    .innerJoin(redditAdAccounts, eq(redditAdsDaily.adAccountId, redditAdAccounts.id))
    .where(
      and(
        gte(redditAdsDaily.date, from),
        lte(redditAdsDaily.date, to),
        eq(redditAdAccounts.currency, "USD"),
      ),
    );
  return BigInt(row?.total ?? "0");
}

// Prior period = the immediately preceding window of the same length, same
// as the PPC/LSA reports' deltas.
export function priorWindow(from: string, to: string): { from: string; to: string } {
  const length = datesInRange(from, to).length;
  return { from: addDaysIso(from, -length), to: addDaysIso(from, -1) };
}

export async function getRedditReport({ from, to }: { from: string; to: string }): Promise<RedditReport> {
  const prior = priorWindow(from, to);
  const [accounts, rows, priorTotalMicros] = await Promise.all([
    listRedditReportAccounts(),
    spendRows(from, to),
    usdTotalMicros(prior.from, prior.to),
  ]);
  return buildRedditReport({ from, to, accounts, rows, priorTotalMicros });
}
