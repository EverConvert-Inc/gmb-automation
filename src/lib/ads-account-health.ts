// Pure logic for the Ads Dashboard's account-health overview (/ads): the
// budget roll-up, pacing, and the rules deciding which accounts need
// attention. No I/O.
//
// Impression share is deliberately NOT rolled up here. Google reports it at
// account level, and an impression-weighted roll-up of campaign rows was
// checked live and found badly off (22% against a true 51% lost to budget)
// because Performance Max impressions skew the weighting.

export type BudgetCampaignRow = {
  campaignId: string;
  campaignName: string;
  status: string; // ENABLED | PAUSED | REMOVED
  channel: string; // SEARCH | PERFORMANCE_MAX | ...
  budgetId: string;
  amountMicros: number | null;
  period: string; // DAILY | CUSTOM_PERIOD | ...
  explicitlyShared: boolean | null;
};

export type BudgetRollup = {
  // One entry per distinct budget that an ENABLED campaign draws on.
  budgets: Array<{
    budgetId: string;
    amount: number | null; // account currency, per `period`
    period: string;
    explicitlyShared: boolean | null;
    enabledCampaigns: string[];
  }>;
  // Sum of DAILY budgets, each budget counted once however many campaigns
  // share it.
  dailyBudget: number;
  // The same sum counted once per campaign — what a naive roll-up gives.
  // Differs from dailyBudget exactly when a budget is shared.
  naiveDailyBudget: number;
  sharedBudgetCount: number;
  // Budgets left out of dailyBudget: not DAILY, or no amount.
  excludedBudgetCount: number;
};

// A budget only constrains spend through campaigns that are running, so
// paused and removed campaigns are ignored. This reads current state, which
// is right for a budget (Google keeps no budget history in these fields).
export function rollupBudgets(rows: BudgetCampaignRow[]): BudgetRollup {
  const byBudget = new Map<string, BudgetRollup["budgets"][number]>();
  let naive = 0;
  for (const r of rows) {
    if (r.status !== "ENABLED" || !r.budgetId) continue;
    const amount = r.amountMicros === null ? null : r.amountMicros / 1_000_000;
    if (r.period === "DAILY" && amount !== null) naive += amount;
    const b = byBudget.get(r.budgetId) ?? {
      budgetId: r.budgetId,
      amount,
      period: r.period,
      explicitlyShared: r.explicitlyShared,
      enabledCampaigns: [],
    };
    b.enabledCampaigns.push(r.campaignName);
    byBudget.set(r.budgetId, b);
  }
  const budgets = Array.from(byBudget.values());
  const counted = budgets.filter((b) => b.period === "DAILY" && b.amount !== null);
  return {
    budgets,
    dailyBudget: counted.reduce((n, b) => n + (b.amount ?? 0), 0),
    naiveDailyBudget: naive,
    sharedBudgetCount: budgets.filter((b) => b.enabledCampaigns.length > 1).length,
    excludedBudgetCount: budgets.length - counted.length,
  };
}

export type Pacing = {
  expected: number; // daily budget x days elapsed
  spend: number;
  // spend / expected: 1 = on budget, below 1 = underspending. Null when
  // there is no budget to pace against.
  ratio: number | null;
};

export function pacing(dailyBudget: number, spend: number, daysElapsed: number): Pacing {
  const expected = dailyBudget * daysElapsed;
  return { expected, spend, ratio: expected > 0 ? spend / expected : null };
}

// Month to date for the month `through` falls in. Anchoring on the through
// date (yesterday when the cron runs) means the 1st of a month still
// reports the whole previous month and never an empty window.
export function monthToDateWindow(through: string): {
  monthStart: string;
  through: string;
  daysElapsed: number;
} {
  return {
    monthStart: `${through.slice(0, 7)}-01`,
    through,
    daysElapsed: Number(through.slice(8, 10)),
  };
}

// Whole days from one ISO date to another (b - a).
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Attention flags
// ---------------------------------------------------------------------------

// Starting points, not findings — tune them here and nowhere else.
export const HEALTH_THRESHOLDS = {
  pacingLow: 0.85, // spending under 85% of budget to date
  pacingHigh: 1.15, // spending over 115% of budget to date
  budgetLost: 0.2, // 20%+ of Search impressions lost to budget
  rankLost: 0.4, // 40%+ of Search impressions lost to rank
  optimizationScore: 0.8, // same bar as the optimization alert email
  junkShare: 0.25, // 25%+ of conversions from likely-junk actions
  wastedShare: 0.3, // 30%+ of Search spend on zero-conversion terms
  noSignedMinSpend: 500, // spend before "no signed cases" is worth saying
  staleDays: 2, // snapshot older than this is not current
} as const;

export type HealthFlagKey =
  | "data"
  | "overspending"
  | "underspending"
  | "no_budget"
  | "budget_lost"
  | "rank_lost"
  | "optimization_score"
  | "junk"
  | "no_signed"
  | "wasted";

export type HealthFlag = { key: HealthFlagKey; label: string };

export type HealthInputs = {
  // Null when the client has no snapshot at all.
  snapshot: {
    ageDays: number; // days the snapshot is behind the overview's through date
    dailyBudget: number;
    mtdSpend: number;
    daysElapsed: number;
    budgetLost: number | null;
    rankLost: number | null;
    optimizationScore: number | null;
    conversions: number | null;
    junkConversions: number | null;
  } | null;
  lastSyncFailed: boolean;
  // Null when the client has no CallRail company linked.
  signedCases: number | null;
  searchSpend: number;
  wastedSpend: number;
  // False when the search-terms window is not fully synced: the wasted
  // figure is then incomplete and is never flagged.
  wastedComplete: boolean;
};

export function junkShare(conversions: number | null, junk: number | null): number | null {
  if (conversions === null || junk === null || conversions <= 0) return null;
  return junk / conversions;
}

export function wastedShare(i: Pick<HealthInputs, "searchSpend" | "wastedSpend" | "wastedComplete">): number | null {
  if (!i.wastedComplete || i.searchSpend <= 0) return null;
  return i.wastedSpend / i.searchSpend;
}

// Everything on a row that needs a person to look, in a fixed order. A
// missing or stale snapshot is reported on its own: its numbers are not
// current, so nothing else is judged from them.
export function healthFlags(i: HealthInputs): HealthFlag[] {
  const T = HEALTH_THRESHOLDS;
  const s = i.snapshot;
  if (!s) return [{ key: "data", label: i.lastSyncFailed ? "Sync failed" : "Not synced" }];
  if (s.ageDays > T.staleDays) return [{ key: "data", label: "Stale data" }];

  const flags: HealthFlag[] = [];
  if (i.lastSyncFailed) flags.push({ key: "data", label: "Sync failed" });

  const pace = pacing(s.dailyBudget, s.mtdSpend, s.daysElapsed);
  if (pace.ratio === null) {
    if (s.mtdSpend > 0) flags.push({ key: "no_budget", label: "No daily budget" });
  } else if (pace.ratio > T.pacingHigh) {
    flags.push({ key: "overspending", label: "Overspending" });
  } else if (pace.ratio < T.pacingLow) {
    flags.push({ key: "underspending", label: "Underspending" });
  }
  if (s.budgetLost !== null && s.budgetLost >= T.budgetLost) {
    flags.push({ key: "budget_lost", label: "Budget-limited" });
  }
  if (s.rankLost !== null && s.rankLost >= T.rankLost) {
    flags.push({ key: "rank_lost", label: "Losing on rank" });
  }
  if (s.optimizationScore !== null && s.optimizationScore < T.optimizationScore) {
    flags.push({ key: "optimization_score", label: "Low opt. score" });
  }
  const junk = junkShare(s.conversions, s.junkConversions);
  if (junk !== null && junk >= T.junkShare) flags.push({ key: "junk", label: "Junk conversions" });
  if (i.signedCases === 0 && s.mtdSpend >= T.noSignedMinSpend) {
    flags.push({ key: "no_signed", label: "No signed cases" });
  }
  const wasted = wastedShare(i);
  if (wasted !== null && wasted >= T.wastedShare) flags.push({ key: "wasted", label: "Wasted spend" });
  return flags;
}

// Most flags first, then biggest spender, then name — so the accounts that
// need a person are at the top and ties go to where the money is.
export function compareByAttention<T extends { flags: HealthFlag[]; mtdSpend: number; name: string }>(
  a: T,
  b: T,
): number {
  return b.flags.length - a.flags.length || b.mtdSpend - a.mtdSpend || a.name.localeCompare(b.name);
}
