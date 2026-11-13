import { describe, expect, it } from "vitest";
import {
  pacing,
  rollupBudgets,
  rollupImpressionShare,
  type BudgetCampaignRow,
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

describe("rollupImpressionShare", () => {
  it("weights by eligible impressions, not by a plain average", () => {
    // A: 100 of 200 eligible (50%), 25% lost to budget. B: 900 of 1000 (90%).
    const r = rollupImpressionShare([
      { impressions: 100, impressionShare: 0.5, budgetLost: 0.25, rankLost: 0.25 },
      { impressions: 900, impressionShare: 0.9, budgetLost: 0, rankLost: 0.1 },
    ]);
    expect(r.eligibleImpressions).toBe(1200);
    expect(r.impressionShare).toBeCloseTo(1000 / 1200, 6);
    expect(r.budgetLost).toBeCloseTo(50 / 1200, 6);
    expect(r.rankLost).toBeCloseTo(150 / 1200, 6);
    expect((r.impressionShare ?? 0) + (r.budgetLost ?? 0) + (r.rankLost ?? 0)).toBeCloseTo(1, 6);
  });

  it("flags campaigns at the <10% floor and skips ones with no share", () => {
    const r = rollupImpressionShare([
      { impressions: 10, impressionShare: 0.0999, budgetLost: 0.5, rankLost: 0.4 },
      { impressions: 10, impressionShare: null, budgetLost: null, rankLost: null },
      { impressions: 0, impressionShare: 0.5, budgetLost: 0, rankLost: 0 },
    ]);
    expect(r.campaignsUsed).toBe(1);
    expect(r.campaignsAtFloor).toBe(1);
    expect(r.campaignsSkipped).toBe(1);
  });

  it("returns nulls when nothing is usable", () => {
    expect(rollupImpressionShare([]).impressionShare).toBeNull();
  });
});
