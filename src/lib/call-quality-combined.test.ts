import { describe, expect, it } from "vitest";
import { combinePpcAndPmaxTotals } from "./call-quality-combined";
import type { CallQualityChannelTotals } from "./queries-call-quality";

function totals(overrides: Partial<CallQualityChannelTotals>): CallQualityChannelTotals {
  return {
    channel: "PPC",
    firstTimeCalls: 0,
    tagCounts: {},
    real: 0,
    junk: 0,
    unclassified: 0,
    costMicros: 0n,
    realCostPerRealLead: null,
    adsReportedCpa: null,
    callViewRowsTotal: 0,
    callViewRowsMatched: 0,
    callViewRowsUnmatched: 0,
    ...overrides,
  };
}

describe("combinePpcAndPmaxTotals", () => {
  it("recovers the true effective CPL — cost never moved, only some real leads did", () => {
    // Before PMax reclassification: this client had 10 real leads on
    // $1,000 of spend ($100 CPL). After reclassification, 4 of those
    // leads moved to PMax, but the $1,000 stayed on PPC (never isolated)
    // — PPC's own CPL alone would misleadingly look like $166.67.
    const ppc = totals({
      real: 6,
      junk: 1,
      costMicros: 1_000_000_000n, // $1,000
      realCostPerRealLead: 1000 / 6,
      adsReportedCpa: 50,
    });
    const pmax = totals({ channel: "PMax", real: 4, junk: 0, costMicros: 0n });

    const combined = combinePpcAndPmaxTotals(ppc, pmax);

    expect(combined.real).toBe(10);
    expect(combined.junk).toBe(1);
    expect(combined.costMicros).toBe(1_000_000_000n);
    expect(combined.realCostPerRealLead).toBeCloseTo(100); // the true $100 CPL, recovered exactly
  });

  it("reuses PPC's own adsReportedCpa unchanged — PMax never has its own conversions to lose", () => {
    const ppc = totals({ real: 5, costMicros: 500_000_000n, adsReportedCpa: 42 });
    const pmax = totals({ channel: "PMax", real: 2 });

    const combined = combinePpcAndPmaxTotals(ppc, pmax);

    expect(combined.adsReportedCpa).toBe(42);
  });

  it("returns null realCostPerRealLead when combined real is zero, same null-on-zero-denominator rule as the individual channels", () => {
    const ppc = totals({ real: 0, costMicros: 0n });
    const pmax = totals({ channel: "PMax", real: 0, costMicros: 0n });

    const combined = combinePpcAndPmaxTotals(ppc, pmax);

    expect(combined.real).toBe(0);
    expect(combined.realCostPerRealLead).toBeNull();
  });

  it("sums firstTimeCalls/junk/unclassified across both channels", () => {
    const ppc = totals({ firstTimeCalls: 20, real: 6, junk: 3, unclassified: 1 });
    const pmax = totals({ channel: "PMax", firstTimeCalls: 5, real: 4, junk: 0, unclassified: 1 });

    const combined = combinePpcAndPmaxTotals(ppc, pmax);

    expect(combined.firstTimeCalls).toBe(25);
    expect(combined.junk).toBe(3);
    expect(combined.unclassified).toBe(2);
  });

  it("includes PMax's costMicros in the sum even if it were ever nonzero (defensive, not assumed-zero)", () => {
    const ppc = totals({ real: 5, costMicros: 100_000_000n });
    const pmax = totals({ channel: "PMax", real: 1, costMicros: 25_000_000n });

    const combined = combinePpcAndPmaxTotals(ppc, pmax);

    expect(combined.costMicros).toBe(125_000_000n);
  });
});
