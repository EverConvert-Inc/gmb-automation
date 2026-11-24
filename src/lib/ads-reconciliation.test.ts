import { describe, expect, it } from "vitest";
import {
  classifyDiff,
  isReconSource,
  reconcile,
  reconSourceLabel,
  type ReconInputs,
  type ReconMapping,
} from "./ads-reconciliation";

function mapping(over: Partial<ReconMapping> = {}): ReconMapping {
  return {
    id: "m1",
    label: "First Time Phone Call",
    adsConversionActionId: "100",
    adsConversionActionName: "First Time Phone Call",
    source: "callrail_first_time_calls",
    enabled: true,
    ...over,
  };
}

function inputs(over: Partial<ReconInputs> = {}): ReconInputs {
  return {
    adsByActionId: {},
    callrail: {
      callrail_first_time_calls: 0,
      callrail_good_leads: 0,
      callrail_form_submissions: 0,
    },
    ...over,
  };
}

describe("classifyDiff", () => {
  it("treats a single-lead gap as noise, even at a high percentage", () => {
    expect(classifyDiff(3, 4).status).toBe("match"); // 25% but only 1 apart
    expect(classifyDiff(1, 0).status).toBe("match");
  });

  it("matches within 10%, warns within 25%, misses beyond", () => {
    expect(classifyDiff(100, 95).status).toBe("match"); // 5%
    expect(classifyDiff(100, 80).status).toBe("watch"); // 20%
    expect(classifyDiff(100, 60).status).toBe("mismatch"); // 40%
  });

  it("is a match and null diff when both are zero", () => {
    expect(classifyDiff(0, 0)).toEqual({ delta: 0, diffPct: null, status: "match" });
  });

  it("delta is ads minus source (sign shows which side is higher)", () => {
    expect(classifyDiff(120, 100).delta).toBe(20);
    expect(classifyDiff(80, 100).delta).toBe(-20);
  });
});

describe("reconcile", () => {
  it("pairs each mapping's Ads count with its CallRail source", () => {
    const { rows } = reconcile(
      [mapping({ adsConversionActionId: "100", source: "callrail_first_time_calls" })],
      inputs({ adsByActionId: { "100": 42 }, callrail: { callrail_first_time_calls: 40, callrail_good_leads: 0, callrail_form_submissions: 0 } }),
    );
    expect(rows[0]).toMatchObject({ adsCount: 42, sourceCount: 40, delta: 2, status: "match" });
  });

  it("missing Ads action id or source value counts as zero, not a crash", () => {
    const { rows } = reconcile([mapping({ adsConversionActionId: "nope" })], inputs());
    expect(rows[0]).toMatchObject({ adsCount: 0, sourceCount: 0, status: "match" });
  });

  it("skips disabled mappings", () => {
    const { rows, summary } = reconcile([mapping({ enabled: false })], inputs());
    expect(rows).toHaveLength(0);
    expect(summary.mapped).toBe(0);
  });

  it("summarises and sorts worst mismatches first", () => {
    const { rows, summary } = reconcile(
      [
        mapping({ id: "ok", adsConversionActionId: "1", source: "callrail_first_time_calls" }),
        mapping({ id: "bad", adsConversionActionId: "2", source: "callrail_good_leads" }),
      ],
      inputs({
        adsByActionId: { "1": 100, "2": 100 },
        callrail: { callrail_first_time_calls: 98, callrail_good_leads: 40, callrail_form_submissions: 0 },
      }),
    );
    expect(rows[0].id).toBe("bad"); // mismatch sorts ahead of match
    expect(summary).toEqual({ mapped: 2, match: 1, watch: 0, mismatch: 1 });
  });
});

describe("source helpers", () => {
  it("labels and type-guards known sources", () => {
    expect(reconSourceLabel("callrail_form_submissions")).toBe("CallRail form submissions");
    expect(isReconSource("callrail_good_leads")).toBe(true);
    expect(isReconSource("nonsense")).toBe(false);
  });
});
