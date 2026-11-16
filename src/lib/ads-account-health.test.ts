import { describe, expect, it } from "vitest";
import {
  compareByTriage,
  daysBetween,
  median,
  monthToDateWindow,
  pacing,
  quantile,
  readPacing,
  rollupBudgets,
  triage,
  type BudgetCampaignRow,
  type PacingDay,
  type Portfolio,
  type TriageInputs,
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

const day = (date: string, dailyBudget: number, spend: number | null): PacingDay => ({ date, dailyBudget, spend });

describe("readPacing", () => {
  it("averages daily spend over the days recorded at the current budget", () => {
    const r = readPacing(
      [day("2026-11-15", 100, 130), day("2026-11-14", 100, 110), day("2026-11-13", 100, 120)],
      100,
    );
    expect(r).toEqual({ judged: true, days: 3, from: "2026-11-13", avgDailySpend: 120, dailyBudget: 100, ratio: 1.2 });
  });

  it("does not read a mid-month budget cut as overspending", () => {
    // Budget cut from 200 to 100 three days ago; spend followed it down.
    // Month to date against today's budget this would look like ~170%.
    const r = readPacing(
      [
        day("2026-11-15", 100, 98),
        day("2026-11-14", 100, 104),
        day("2026-11-13", 100, 101),
        day("2026-11-12", 200, 195),
        day("2026-11-11", 200, 210),
      ],
      100,
    );
    expect(r).toMatchObject({ judged: true, days: 3, from: "2026-11-13" });
    expect((r as { ratio: number }).ratio).toBeCloseTo(1.01, 2);
  });

  it("is not judged until enough days exist at the current budget", () => {
    expect(readPacing([day("2026-11-15", 100, 300), day("2026-11-14", 200, 190)], 100)).toEqual({
      judged: false,
      reason: "too_few_days",
      days: 1,
    });
    // Rows written before day spend was stored cannot be averaged.
    expect(readPacing([day("2026-11-15", 100, null)], 100)).toMatchObject({ judged: false, days: 0 });
    expect(readPacing([], 100)).toMatchObject({ judged: false, reason: "too_few_days" });
  });

  it("looks back no further than the window, and has nothing to say without a budget", () => {
    const ten = Array.from({ length: 10 }, (_, i) => day(`2026-11-${String(15 - i).padStart(2, "0")}`, 100, 100));
    expect(readPacing(ten, 100)).toMatchObject({ judged: true, days: 7, from: "2026-11-09" });
    expect(readPacing(ten, 0)).toEqual({ judged: false, reason: "no_budget", days: 0 });
  });
});

describe("quantile", () => {
  it("interpolates, and is null for nothing", () => {
    expect(median([1, 3, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(quantile([0, 10, 20, 30, 40], 0.75)).toBe(30);
    expect(median([])).toBeNull();
  });
});

const portfolio: Portfolio = { costPerSigned: 4000, wastedShareP75: 0.3, budgetLostMedian: 0.3, rankLostMedian: 0.45 };
const quiet: TriageInputs = {
  data: "ok",
  mtdSpend: 3000,
  conversions: 20,
  junkConversions: 1,
  junkActions: [],
  pacing: { judged: true, days: 7, from: "2026-11-09", avgDailySpend: 100, dailyBudget: 100, ratio: 1 },
  signed: { lastSignedDate: "2026-11-02", spendSinceLastSigned: 1500, ownCostPerSigned: 5000 },
  wasted: { dollars: 200, terms: 2, share: 0.1 },
  optimizationScore: 1,
  budgetLost: 0.1,
  rankLost: 0.5,
};
const t = (over: Partial<TriageInputs>, p: Portfolio = portfolio) => triage({ ...quiet, ...over }, p);

describe("triage", () => {
  it("raises nothing on an account that is merely normal for the portfolio", () => {
    // No signed case this month, half of impressions lost to rank, a little
    // spend on non-converting terms: all ordinary, none worth a look.
    expect(t({})).toMatchObject({ tier: "ok", primary: null, secondary: null, opportunity: null });
  });

  it("names the junk action and calls a junk-dominated account an emergency", () => {
    const r = t({
      mtdSpend: 3514.86,
      conversions: 186.99,
      junkConversions: 183,
      junkActions: [{ name: "Website Click to Call", conversions: 179 }, { name: "Page view", conversions: 4 }],
    });
    expect(r.tier).toBe("act");
    expect(r.primary?.kind).toBe("junk");
    // Stated as our classification, not as a fact about the account.
    expect(r.primary?.text).toBe(
      "Website Click to Call: 179 of 187 conversions, an action we class as non-lead (98% non-lead in all).",
    );
    expect(t({ conversions: 100, junkConversions: 90 }).primary?.text).toBe(
      "90 of 100 conversions (90%) come from actions we class as non-lead.",
    );
    expect(r.primary?.dollars).toBeCloseTo(3514.86 * (183 / 186.99), 2);
  });

  it("scales junk by volume: small counts are a watch at most, tiny ones nothing", () => {
    expect(t({ conversions: 5, junkConversions: 5 }).tier).toBe("watch"); // 5 of 5
    expect(t({ conversions: 4, junkConversions: 4 }).tier).toBe("ok");
    expect(t({ conversions: 24, junkConversions: 6 }).tier).toBe("watch"); // 25%
    expect(t({ conversions: 100, junkConversions: 20 }).tier).toBe("ok"); // 20%
    expect(t({ conversions: 43.83, junkConversions: 27.6 }).tier).toBe("act"); // 63%
    expect(t({ conversions: null, junkConversions: null }).tier).toBe("ok");
  });

  it("does not judge wasted spend when conversions are mostly junk, and says so", () => {
    const junky = { conversions: 100, junkConversions: 90 };
    const wasted = { dollars: 5000, terms: 9, share: 0.8 };
    expect(t({ wasted }).primary?.kind).toBe("wasted");
    const r = t({ ...junky, wasted });
    expect([r.primary?.kind, r.secondary?.kind]).toEqual(["junk", undefined]);
    expect(r.note).toBe("Wasted spend is not judged while most conversions are non-lead actions.");
  });

  it("flags overpacing only when it is both large and worth real money", () => {
    const pace = (avg: number, budget: number): TriageInputs["pacing"] => ({
      judged: true, days: 7, from: "2026-11-09", avgDailySpend: avg, dailyBudget: budget, ratio: avg / budget,
    });
    const over = t({ pacing: pace(188, 100) });
    expect(over.tier).toBe("act");
    expect(over.primary?.text).toBe(
      "Averaging $188/day against a $100/day budget over the last 7 days (188%) — about $2,675 a month over at this rate.",
    );
    expect(t({ pacing: pace(120, 100) }).tier).toBe("watch"); // 120%
    expect(t({ pacing: pace(13, 10) }).tier).toBe("watch"); // 130% but $91 a month
    expect(t({ pacing: pace(110, 100) }).tier).toBe("ok");
    const under = t({ pacing: pace(60, 100) });
    expect([under.tier, under.primary?.kind]).toEqual(["watch", "pacing_under"]);
    expect(t({ pacing: { judged: false, reason: "too_few_days", days: 1 } })).toMatchObject({
      tier: "ok",
      note: "Pacing not judged yet: 1 day recorded at the current budget (needs 3).",
    });
  });

  it("treats a signed-case gap as context: it never sets a tier or a rank", () => {
    const signed = (spend: number, own: number | null, last: string | null = "2026-08-03") => ({
      lastSignedDate: last, spendSinceLastSigned: spend, ownCostPerSigned: own,
    });
    const gap = t({ signed: signed(12400, 4100) });
    expect([gap.tier, gap.primary]).toEqual(["ok", null]);
    expect(gap.signedContext).toBe(
      "About $12,400 spent since CallRail's last signed case (Aug 3); its own average is about $4,100 per signed case.",
    );
    expect(t({ signed: signed(20000, null, null) }).signedContext).toBe(
      "About $20,000 spent with no signed case in CallRail for 180 days; accounts here average about $4,000 per signed case.",
    );
    expect(t({ signed: signed(5000, 5000) }).signedContext).toBeNull(); // 1x its own average
    expect(t({ signed: null }).signedContext).toBeNull(); // no CallRail
    expect(t({ signed: signed(20000, null, null) }, { ...portfolio, costPerSigned: null }).signedContext).toBeNull();
  });

  it("flags wasted spend only against the portfolio and above a dollar floor", () => {
    expect(t({ wasted: { dollars: 1200, terms: 6, share: 0.35 } }).primary?.text).toBe(
      "$1,200 (35% of Search spend) went to 6 search terms that each cost more than a conversion and produced none, last 30 days.",
    );
    expect(t({ wasted: { dollars: 400, terms: 1, share: 0.9 } }).tier).toBe("ok");
    expect(t({ wasted: { dollars: 1200, terms: 6, share: 0.2 } }).tier).toBe("ok");
    expect(t({ wasted: null }).tier).toBe("ok");
  });

  it("puts junk first among emergencies and keeps one secondary", () => {
    const r = t({
      conversions: 100,
      junkConversions: 90,
      pacing: { judged: true, days: 7, from: "2026-11-09", avgDailySpend: 400, dailyBudget: 100, ratio: 4 },
      optimizationScore: 0.5,
    });
    expect([r.primary?.kind, r.secondary?.kind]).toEqual(["junk", "pacing_over"]);
  });

  it("offers budget-limited as an opportunity only where cases are being signed cheaply", () => {
    const cheap = { lastSignedDate: "2026-11-10", spendSinceLastSigned: 500, ownCostPerSigned: 2100 };
    const r = t({ budgetLost: 0.52, signed: cheap });
    expect(r.tier).toBe("ok");
    expect(r.opportunity).toBe(
      "Budget-limited (52% of Search impressions lost to budget) while CallRail shows cases signing at about $2,100 each.",
    );
    expect(t({ budgetLost: 0.52 }).opportunity).toBeNull(); // $5,000 a case is above typical
    expect(t({ budgetLost: 0.52, signed: cheap, conversions: 100, junkConversions: 90 }).opportunity).toBeNull();
  });

  it("marks lost impression share only when well above the portfolio's normal", () => {
    expect(t({ budgetLost: 0.5, rankLost: 0.69 }).marks).toEqual({ budgetLost: true, rankLost: true });
    expect(t({ budgetLost: 0.4, rankLost: 0.5 }).marks).toEqual({ budgetLost: false, rankLost: false });
  });

  it("judges nothing from missing, stale or failed data", () => {
    for (const data of ["missing", "stale", "failed"] as const) {
      const r = t({ data, conversions: 100, junkConversions: 99 });
      expect([r.tier, r.primary]).toEqual(["nodata", null]);
      expect(r.note).toBeTruthy();
    }
  });

  it("ranks on the most trusted signal: a non-lead account outranks a bigger pacing or signed-gap problem", () => {
    const row = (name: string, mtdSpend: number, x: Partial<TriageInputs>) => ({ name, mtdSpend, triage: t(x) });
    const overpacing: TriageInputs["pacing"] = {
      judged: true, days: 7, from: "2026-11-09", avgDailySpend: 900, dailyBudget: 300, ratio: 3,
    };
    const rows = [
      row("Quiet big", 9000, {}),
      row("No data", 100, { data: "missing" }),
      // A huge signed-case gap: context only, so this account is not raised at all.
      row("Signed gap", 8000, { signed: { lastSignedDate: "2026-06-01", spendSinceLastSigned: 60000, ownCostPerSigned: 4000 } }),
      row("Overpacing", 9000, { pacing: overpacing }), // ~$18k a month over
      row("Small non-lead", 1000, { mtdSpend: 1000, conversions: 100, junkConversions: 90 }),
      row("Big non-lead", 5000, { mtdSpend: 5000, conversions: 100, junkConversions: 90 }),
      row("Watch", 2000, { optimizationScore: 0.5 }),
    ];
    expect(rows.sort(compareByTriage).map((r) => r.name)).toEqual([
      "Big non-lead", "Small non-lead", "Overpacing", "Watch", "Quiet big", "Signed gap", "No data",
    ]);
  });
});
