import { describe, expect, it } from "vitest";
import {
  compareByAttention,
  daysBetween,
  healthFlags,
  monthToDateWindow,
  pacing,
  rollupBudgets,
  type BudgetCampaignRow,
  type HealthInputs,
} from "./ads-account-health";

const camp = (over: Partial<BudgetCampaignRow>): BudgetCampaignRow => ({
  campaignId: "1",
  campaignName: "A",
  status: "ENABLED",
  channel: "SEARCH",
  budgetId: "b1",
  amountMicros: 100_000_000,
  period: "DAILY",
  explicitlyShared: false,
  ...over,
});

describe("rollupBudgets", () => {
  it("counts a shared budget once, not once per campaign", () => {
    const r = rollupBudgets([
      camp({ campaignName: "A", budgetId: "shared", explicitlyShared: true }),
      camp({ campaignName: "B", budgetId: "shared", explicitlyShared: true }),
      camp({ campaignName: "C", budgetId: "own", amountMicros: 50_000_000 }),
    ]);
    expect(r.dailyBudget).toBe(150);
    expect(r.naiveDailyBudget).toBe(250);
    expect(r.sharedBudgetCount).toBe(1);
    expect(r.budgets.find((b) => b.budgetId === "shared")?.enabledCampaigns).toEqual(["A", "B"]);
  });

  it("ignores paused and removed campaigns", () => {
    const r = rollupBudgets([
      camp({ budgetId: "b1" }),
      camp({ budgetId: "b2", status: "PAUSED" }),
      camp({ budgetId: "b3", status: "REMOVED" }),
    ]);
    expect(r.dailyBudget).toBe(100);
    expect(r.budgets).toHaveLength(1);
  });

  it("leaves non-daily and amountless budgets out of the daily total, and says so", () => {
    const r = rollupBudgets([
      camp({ budgetId: "b1" }),
      camp({ budgetId: "b2", period: "CUSTOM_PERIOD" }),
      camp({ budgetId: "b3", amountMicros: null }),
    ]);
    expect(r.dailyBudget).toBe(100);
    expect(r.excludedBudgetCount).toBe(2);
  });
});

describe("pacing", () => {
  it("compares spend with daily budget times days elapsed", () => {
    expect(pacing(100, 900, 12)).toEqual({ expected: 1200, spend: 900, ratio: 0.75 });
  });

  it("has no ratio without a budget", () => {
    expect(pacing(0, 50, 12).ratio).toBeNull();
  });
});

describe("monthToDateWindow", () => {
  it("covers the month the through date falls in", () => {
    expect(monthToDateWindow("2026-11-12")).toEqual({
      monthStart: "2026-11-01",
      through: "2026-11-12",
      daysElapsed: 12,
    });
  });

  it("reports the whole previous month when run on the 1st", () => {
    // Cron on Dec 1 runs through Nov 30.
    expect(monthToDateWindow("2026-11-30")).toEqual({
      monthStart: "2026-11-01",
      through: "2026-11-30",
      daysElapsed: 30,
    });
  });

  it("counts whole days between dates", () => {
    expect(daysBetween("2026-10-30", "2026-11-02")).toBe(3);
    expect(daysBetween("2026-11-02", "2026-11-02")).toBe(0);
  });
});

const healthy: HealthInputs = {
  snapshot: {
    ageDays: 0,
    dailyBudget: 100,
    mtdSpend: 1200,
    daysElapsed: 12,
    budgetLost: 0.05,
    rankLost: 0.2,
    optimizationScore: 0.9,
    conversions: 20,
    junkConversions: 1,
  },
  lastSyncFailed: false,
  signedCases: 3,
  searchSpend: 1000,
  wastedSpend: 100,
  wastedComplete: true,
};
const withSnapshot = (over: Partial<NonNullable<HealthInputs["snapshot"]>>): HealthInputs => ({
  ...healthy,
  snapshot: { ...healthy.snapshot!, ...over },
});
const keys = (i: HealthInputs) => healthFlags(i).map((f) => f.key);

describe("healthFlags", () => {
  it("raises nothing on a healthy account", () => {
    expect(healthFlags(healthy)).toEqual([]);
  });

  it("flags pacing on either side of the band, and a missing budget", () => {
    expect(keys(withSnapshot({ mtdSpend: 1500 }))).toEqual(["overspending"]);
    expect(keys(withSnapshot({ mtdSpend: 900 }))).toEqual(["underspending"]);
    expect(keys(withSnapshot({ mtdSpend: 1100 }))).toEqual([]);
    expect(keys(withSnapshot({ dailyBudget: 0 }))).toEqual(["no_budget"]);
    expect(keys({ ...withSnapshot({ dailyBudget: 0, mtdSpend: 0 }), signedCases: null })).toEqual([]);
  });

  it("flags each metric at its threshold and not below it", () => {
    expect(keys(withSnapshot({ budgetLost: 0.2 }))).toEqual(["budget_lost"]);
    expect(keys(withSnapshot({ budgetLost: 0.19 }))).toEqual([]);
    expect(keys(withSnapshot({ rankLost: 0.4 }))).toEqual(["rank_lost"]);
    expect(keys(withSnapshot({ optimizationScore: 0.79 }))).toEqual(["optimization_score"]);
    expect(keys(withSnapshot({ optimizationScore: 0.8 }))).toEqual([]);
    expect(keys(withSnapshot({ junkConversions: 5 }))).toEqual(["junk"]);
    expect(keys({ ...healthy, wastedSpend: 300 })).toEqual(["wasted"]);
  });

  it("never flags a figure it does not have", () => {
    const blank = withSnapshot({
      budgetLost: null,
      rankLost: null,
      optimizationScore: null,
      conversions: null,
      junkConversions: null,
    });
    expect(healthFlags(blank)).toEqual([]);
    // Zero conversions is not a junk share of anything.
    expect(keys(withSnapshot({ conversions: 0, junkConversions: 0 }))).toEqual([]);
  });

  it("only says no signed cases when CallRail is linked and real money was spent", () => {
    expect(keys({ ...healthy, signedCases: 0 })).toEqual(["no_signed"]);
    expect(keys({ ...healthy, signedCases: null })).toEqual([]);
    expect(keys({ ...withSnapshot({ mtdSpend: 400, dailyBudget: 400 / 12 }), signedCases: 0 })).toEqual([]);
  });

  it("does not flag wasted spend from a partly synced window", () => {
    expect(keys({ ...healthy, wastedSpend: 900, wastedComplete: false })).toEqual([]);
  });

  it("reports missing or stale data alone, without judging old numbers", () => {
    expect(healthFlags({ ...healthy, snapshot: null })).toEqual([{ key: "data", label: "Not synced" }]);
    expect(healthFlags({ ...healthy, snapshot: null, lastSyncFailed: true })).toEqual([
      { key: "data", label: "Sync failed" },
    ]);
    expect(healthFlags(withSnapshot({ ageDays: 3, budgetLost: 0.9 }))).toEqual([
      { key: "data", label: "Stale data" },
    ]);
    expect(keys(withSnapshot({ ageDays: 2 }))).toEqual([]);
  });

  it("sorts most-flagged first, then by spend", () => {
    const rows = [
      { name: "B", mtdSpend: 5000, flags: [] },
      { name: "A", mtdSpend: 100, flags: [{ key: "junk" as const, label: "" }] },
      { name: "C", mtdSpend: 9000, flags: [] },
    ];
    expect(rows.sort(compareByAttention).map((r) => r.name)).toEqual(["A", "C", "B"]);
  });
});
