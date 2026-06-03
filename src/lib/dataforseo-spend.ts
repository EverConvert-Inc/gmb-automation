import { asc, gte } from "drizzle-orm";
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
  // Month-to-date spend in USD. null if the DataForSEO call failed.
  spentUsd: number | null;
  // The lifetime-spend anchor we diffed against, and the date it was
  // captured. The anchor is the FIRST snapshot stored in the current
  // month — set automatically the first time the indicator is hit
  // after the 1st rolls over.
  anchorUsd: number | null;
  anchorDate: string | null;
  state: "ready" | "error";
};

// Computes month-to-date DataForSEO API spend by:
// 1. Calling /v3/appendix/user_data for the current lifetime spent
//    (money.total - money.balance — DataForSEO doesn't expose a
//    monthly-spent field directly).
// 2. Inserting today's snapshot IF NOT EXISTS, so the first call of
//    each day captures that day's lifetime once and freezes it.
// 3. Finding the EARLIEST snapshot in the current calendar month —
//    that's the anchor. The first time the indicator is hit each
//    month, today's snapshot becomes the anchor; subsequent days
//    inherit the same anchor until the next 1st.
// 4. MTD = current lifetime - anchor. Clamped to ≥ 0 in case of
//    refunds.
//
// Behavioral consequences:
// - Today (first call of the install): captures today's snapshot, that
//   IS the anchor, so MTD = 0. Grows from here through the rest of
//   the month.
// - 1st of next month, first call: captures a new snapshot for that
//   day, which becomes next month's anchor, resetting MTD to 0.
// - If nobody opens the app on the 1st, the first call (say the 4th)
//   becomes the anchor and MTD undercounts the 1st-3rd. Acceptable
//   for an app that's used most days.
export async function getMonthlyDataForSeoSpend(): Promise<SeoSpendResult> {
  const money = await getDataForSeoMoneySnapshot();
  if (!money) {
    return {
      spentUsd: null,
      anchorUsd: null,
      anchorDate: null,
      state: "error",
    };
  }

  const today = todayIso();
  const monthStart = firstOfMonthIso();
  const currentLifetime = money.lifetimeSpentUsd;

  // Insert today's snapshot IF NOT EXISTS. Critical that we don't
  // overwrite — same-day calls would otherwise keep moving the anchor
  // forward, and MTD would never grow within day 1 of the month.
  await db
    .insert(dataforseoSpendSnapshots)
    .values({
      date: today,
      lifetimeSpentUsd: String(currentLifetime),
    })
    .onConflictDoNothing({
      target: dataforseoSpendSnapshots.date,
    });

  // Earliest snapshot in the current month → the anchor.
  const anchor = await db
    .select({
      date: dataforseoSpendSnapshots.date,
      lifetimeSpentUsd: dataforseoSpendSnapshots.lifetimeSpentUsd,
    })
    .from(dataforseoSpendSnapshots)
    .where(gte(dataforseoSpendSnapshots.date, monthStart))
    .orderBy(asc(dataforseoSpendSnapshots.date))
    .limit(1);

  // Anchor always exists at this point — we just upserted today's row
  // and today is by definition in the current month. The empty check
  // is purely defensive against an unlikely race.
  if (anchor.length === 0) {
    return {
      spentUsd: 0,
      anchorUsd: currentLifetime,
      anchorDate: today,
      state: "ready",
    };
  }

  const anchorUsd = Number(anchor[0].lifetimeSpentUsd);
  const spent = Math.max(0, currentLifetime - anchorUsd);
  return {
    spentUsd: Math.round(spent * 100) / 100,
    anchorUsd,
    anchorDate: anchor[0].date,
    state: "ready",
  };
}
