import { describe, expect, it } from "vitest";
import type { CampaignSettings } from "./queries-ads-dashboard";
import { evaluateCampaign, evaluateCompliance, matchesStandard, type Standard } from "./ads-standards";

function campaign(over: Partial<CampaignSettings> = {}): CampaignSettings {
  return {
    campaignId: "1",
    name: "Brand - Search",
    status: "ENABLED",
    type: "SEARCH",
    biddingStrategy: "MAXIMIZE_CONVERSIONS",
    adServing: "OPTIMIZE",
    dailyBudget: 50,
    budgetDelivery: "STANDARD",
    budgetShared: false,
    trackingTemplate: "",
    networks: { googleSearch: true, searchPartners: false, display: false, youtube: false },
    ...over,
  };
}

function standard(over: Partial<Standard> = {}): Standard {
  return {
    id: "s1",
    name: "Search baseline",
    enabled: true,
    match: { channelType: "SEARCH" },
    campaignExpected: { budgetDelivery: "STANDARD", networkDisplay: false },
    adGroupExpected: {},
    ...over,
  };
}

describe("matchesStandard", () => {
  it("matches on channel type and name substring (case-insensitive)", () => {
    expect(matchesStandard(campaign(), { channelType: "SEARCH" })).toBe(true);
    expect(matchesStandard(campaign(), { channelType: "PERFORMANCE_MAX" })).toBe(false);
    expect(matchesStandard(campaign({ name: "Brand - Search" }), { nameContains: "brand" })).toBe(true);
    expect(matchesStandard(campaign(), { nameContains: "pmax" })).toBe(false);
    expect(matchesStandard(campaign(), {})).toBe(true); // no conditions = any
  });
});

describe("evaluateCampaign", () => {
  it("passes when every enforced field matches", () => {
    const v = evaluateCampaign(campaign(), [standard()]);
    expect(v.verdict).toBe("passed");
    expect(v.failures).toEqual([]);
    expect(v.standardName).toBe("Search baseline");
  });

  it("errors and lists the mismatching fields", () => {
    const v = evaluateCampaign(campaign({ networks: { googleSearch: true, searchPartners: false, display: true, youtube: false } }), [standard()]);
    expect(v.verdict).toBe("error");
    expect(v.failures).toEqual([{ key: "networkDisplay", label: "Display network", expected: false, actual: true }]);
  });

  it("is unmatched when no enabled standard applies", () => {
    expect(evaluateCampaign(campaign({ type: "PERFORMANCE_MAX" }), [standard()]).verdict).toBe("unmatched");
    expect(evaluateCampaign(campaign(), [standard({ enabled: false })]).verdict).toBe("unmatched");
  });

  it("uses the first matching enabled standard", () => {
    const first = standard({ id: "a", name: "A", campaignExpected: { budgetDelivery: "ACCELERATED" } });
    const second = standard({ id: "b", name: "B", campaignExpected: { budgetDelivery: "STANDARD" } });
    const v = evaluateCampaign(campaign(), [first, second]);
    expect(v.standardId).toBe("a");
    expect(v.verdict).toBe("error"); // governed by A, which wants ACCELERATED
  });
});

describe("needs review", () => {
  const anyType = standard({ match: {}, campaignExpected: { networkDisplay: false } });

  it("does not score network toggles on Performance Max", () => {
    const pmax = campaign({
      type: "PERFORMANCE_MAX",
      networks: { googleSearch: false, searchPartners: false, display: true, youtube: true },
    });
    const v = evaluateCampaign(pmax, [anyType]);
    expect(v.verdict).toBe("review");
    expect(v.failures).toEqual([]);
    expect(v.unverified).toEqual([
      { key: "networkDisplay", label: "Display network", expected: false, reason: "not_applicable" },
    ]);
  });

  it("does not pass or fail an enum Google returned no real value for", () => {
    for (const unknown of ["", "UNKNOWN", "UNSPECIFIED", "UNAVAILABLE"]) {
      const v = evaluateCampaign(campaign({ adServing: unknown }), [
        standard({ campaignExpected: { adServing: "OPTIMIZE" } }),
      ]);
      expect(v.verdict).toBe("review");
      expect(v.unverified[0].reason).toBe("unknown");
    }
  });

  it("a definite failure still wins over an unverifiable field", () => {
    const v = evaluateCampaign(campaign({ adServing: "UNKNOWN", budgetDelivery: "ACCELERATED" }), [
      standard({ campaignExpected: { adServing: "OPTIMIZE", budgetDelivery: "STANDARD" } }),
    ]);
    expect(v.verdict).toBe("error");
    expect(v.failures.map((f) => f.key)).toEqual(["budgetDelivery"]);
    expect(v.unverified.map((f) => f.key)).toEqual(["adServing"]);
  });

  it("is counted separately and left out of compliance %", () => {
    const { summary } = evaluateCompliance(
      [campaign({ campaignId: "ok" }), campaign({ campaignId: "pm", type: "PERFORMANCE_MAX" })],
      [anyType],
    );
    expect(summary).toEqual({ evaluated: 1, passed: 1, errors: 0, review: 1, unmatched: 0, compliancePct: 1 });
  });
});

describe("evaluateCompliance", () => {
  it("summarises passed/errors/unmatched and compliance over evaluated only", () => {
    const campaigns = [
      campaign({ campaignId: "ok" }),
      campaign({ campaignId: "bad", networks: { googleSearch: true, searchPartners: false, display: true, youtube: false } }),
      campaign({ campaignId: "other", type: "PERFORMANCE_MAX" }),
    ];
    const { summary } = evaluateCompliance(campaigns, [standard()]);
    expect(summary).toEqual({ evaluated: 2, passed: 1, errors: 1, review: 0, unmatched: 1, compliancePct: 0.5 });
  });

  it("compliancePct is null when nothing is evaluated", () => {
    expect(evaluateCompliance([campaign({ type: "PERFORMANCE_MAX" })], [standard()]).summary.compliancePct).toBeNull();
  });
});
