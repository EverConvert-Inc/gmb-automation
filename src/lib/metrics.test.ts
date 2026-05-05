import { describe, expect, it } from "vitest";
import { computeScanMetrics, rankBucket, rankColor } from "./metrics";

describe("computeScanMetrics", () => {
  it("returns zeros for empty input", () => {
    const m = computeScanMetrics([]);
    expect(m).toEqual({ arp: null, solv: 0, coverage: 0, totalPoints: 0, rankedPoints: 0 });
  });

  it("ignores null ranks for ARP by default", () => {
    const m = computeScanMetrics([
      { rank: 1 },
      { rank: 5 },
      { rank: null },
      { rank: null },
    ]);
    expect(m.arp).toBe(3);
    expect(m.coverage).toBe(50);
    expect(m.solv).toBe(25);
  });

  it("treats null as 21 when requested", () => {
    const m = computeScanMetrics(
      [{ rank: 1 }, { rank: 1 }, { rank: null }, { rank: null }],
      "treat_null_as_21",
    );
    expect(m.arp).toBe((1 + 1 + 21 + 21) / 4);
  });

  it("treats null as 100 when requested", () => {
    const m = computeScanMetrics(
      [{ rank: 1 }, { rank: null }],
      "treat_null_as_100",
    );
    expect(m.arp).toBe((1 + 100) / 2);
  });

  it("computes SoLV as percent of cells in top 3", () => {
    const points = [
      { rank: 1 },
      { rank: 2 },
      { rank: 3 },
      { rank: 4 },
      { rank: null },
    ];
    expect(computeScanMetrics(points).solv).toBe(60);
  });

  it("ARP is null when every point is unranked under ignore_null", () => {
    const m = computeScanMetrics([{ rank: null }, { rank: null }]);
    expect(m.arp).toBeNull();
    expect(m.coverage).toBe(0);
    expect(m.solv).toBe(0);
  });
});

describe("rankColor / rankBucket", () => {
  it("buckets ranks correctly", () => {
    expect(rankBucket(1)).toBe("1-3");
    expect(rankBucket(3)).toBe("1-3");
    expect(rankBucket(4)).toBe("4-10");
    expect(rankBucket(10)).toBe("4-10");
    expect(rankBucket(11)).toBe("11-20");
    expect(rankBucket(20)).toBe("11-20");
    expect(rankBucket(21)).toBe("21+");
    expect(rankBucket(null)).toBe("none");
  });

  it("colors line up with buckets", () => {
    expect(rankColor(1)).toBe("#22c55e");
    expect(rankColor(8)).toBe("#facc15");
    expect(rankColor(15)).toBe("#fb923c");
    expect(rankColor(50)).toBe("#ef4444");
    expect(rankColor(null)).toBe("#9ca3af");
  });
});
