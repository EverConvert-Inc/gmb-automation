import { desc, lt } from "drizzle-orm";
import { db } from "./db/client";
import { dataforseoSpendSnapshots } from "./db/schema";
import { getDataForSeoMoneySnapshot } from "./dataforseo";

// Returns today's date in UTC as YYYY-MM-DD.
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Returns the first day of the current month in UTC as YYYY-MM-DD.
function firstOfMonthIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

export type SeoSpendResult = {
  // Month-to-date spend in USD. null if we can't compute it (DataForSEO
  // unreachable, missing env vars, or no baseline snapshot yet).
  spentUsd: number | null;
  // The lifetime-spend baseline we diffed against, and the date it was
  // captured. Useful for the indicator's hover tooltip.
  baselineUsd: number | null;
  baselineDate: string | null;
  // Either "ready" (we have a real MTD), "seeding" (just captured the
  // first snapshot, MTD will be accurate next month), or "error"
  // (DataForSEO call failed).
  state: "ready" | "seeding" | "error";
};

// Computes month-to-date DataForSEO API spend by:
// 1. Calling /v3/appendix/user_data for the current lifetime spent
//    (money.total - money.balance — DataForSEO doesn't expose a
//    monthly-spent field directly).
// 2. Looking up the most recent snapshot stored BEFORE the first of the
//    current month — that's our month-start baseline.
// 3. MTD = current lifetime - baseline. Clamped to ≥ 0 in case the
//    operator did a refund that shrunk total.
// 4. Always upserts today's snapshot before returning, so future calls
//    have an ever-more-accurate baseline.
//
// On first install (no baseline before this month exists yet), captures
// today's snapshot and returns "seeding" so the UI shows "—". Next month
// will work correctly.
export async function getMonthlyDataForSeoSpend(): Promise<SeoSpendResult> {
  const money = await getDataForSeoMoneySnapshot();
  if (!money) {
    return {
      spentUsd: null,
      baselineUsd: null,
      baselineDate: null,
      state: "error",
    };
  }

  const today = todayIso();
  const monthStart = firstOfMonthIso();
  const currentLifetime = money.lifetimeSpentUsd;

  // Snapshot today's value. Upsert because the cache may call us multiple
  // times per day; later calls overwrite earlier ones (lifetime only
  // grows, so this just keeps it fresh).
  await db
    .insert(dataforseoSpendSnapshots)
    .values({
      date: today,
      lifetimeSpentUsd: String(currentLifetime),
    })
    .onConflictDoUpdate({
      target: dataforseoSpendSnapshots.date,
      set: {
        lifetimeSpentUsd: String(currentLifetime),
        capturedAt: new Date(),
      },
    });

  // Find the most-recent snapshot strictly before the first of this
  // month — that's our baseline.
  const baseline = await db
    .select({
      date: dataforseoSpendSnapshots.date,
      lifetimeSpentUsd: dataforseoSpendSnapshots.lifetimeSpentUsd,
    })
    .from(dataforseoSpendSnapshots)
    .where(lt(dataforseoSpendSnapshots.date, monthStart))
    .orderBy(desc(dataforseoSpendSnapshots.date))
    .limit(1);

  if (baseline.length === 0) {
    return {
      spentUsd: null,
      baselineUsd: null,
      baselineDate: null,
      state: "seeding",
    };
  }

  const baselineUsd = Number(baseline[0].lifetimeSpentUsd);
  const spent = Math.max(0, currentLifetime - baselineUsd);
  return {
    spentUsd: Math.round(spent * 100) / 100,
    baselineUsd,
    baselineDate: baseline[0].date,
    state: "ready",
  };
}
