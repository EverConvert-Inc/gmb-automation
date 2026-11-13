// Pure roll-ups for the Ads Dashboard's account-health overview: campaign
// budgets, pacing and impression share, each reduced from per-campaign rows
// to one figure per client. No I/O — the diagnostic route uses these today
// to check the arithmetic against live accounts before anything is stored.

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

export type ShareCampaignRow = {
  impressions: number;
  impressionShare: number | null;
  budgetLost: number | null;
  rankLost: number | null;
};

export type ShareRollup = {
  impressionShare: number | null;
  budgetLost: number | null;
  rankLost: number | null;
  eligibleImpressions: number;
  campaignsUsed: number;
  // Campaigns whose impression share came back as Google's "<10%" floor
  // (0.0999): their eligible impressions are a lower bound, so the roll-up
  // is approximate whenever this is above zero.
  campaignsAtFloor: number;
  // Campaigns with impressions but no usable impression share.
  campaignsSkipped: number;
};

const FLOOR = 0.1;

// Shares cannot be averaged or summed across campaigns. Each campaign's
// share implies how many impressions it was eligible for
// (impressions / share); weighting by that turns the per-campaign ratios
// back into one account ratio.
export function rollupImpressionShare(rows: ShareCampaignRow[]): ShareRollup {
  let impressions = 0;
  let eligible = 0;
  let budgetLost = 0;
  let rankLost = 0;
  let used = 0;
  let atFloor = 0;
  let skipped = 0;
  for (const r of rows) {
    if (r.impressions <= 0) continue;
    if (r.impressionShare === null || !(r.impressionShare > 0)) {
      skipped += 1;
      continue;
    }
    const e = r.impressions / r.impressionShare;
    impressions += r.impressions;
    eligible += e;
    budgetLost += e * (r.budgetLost ?? 0);
    rankLost += e * (r.rankLost ?? 0);
    used += 1;
    if (r.impressionShare < FLOOR) atFloor += 1;
  }
  return {
    impressionShare: eligible > 0 ? impressions / eligible : null,
    budgetLost: eligible > 0 ? budgetLost / eligible : null,
    rankLost: eligible > 0 ? rankLost / eligible : null,
    eligibleImpressions: Math.round(eligible),
    campaignsUsed: used,
    campaignsAtFloor: atFloor,
    campaignsSkipped: skipped,
  };
}
