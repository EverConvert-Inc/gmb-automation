import { describe, expect, it } from "vitest";
import {
  comparisonRange,
  describeChange,
  eachIsoDate,
  isFullySynced,
  isIsoDate,
  parseCompareMode,
  pctChange,
} from "./ads-dashboard-compare";

describe("comparisonRange", () => {
  it("WoW moves both ends back 7 days, across month and year ends", () => {
    expect(comparisonRange("2026-11-06", "2026-11-12", "wow")).toEqual({ from: "2026-10-30", to: "2026-11-05" });
    expect(comparisonRange("2026-01-03", "2026-01-05", "wow")).toEqual({ from: "2025-12-27", to: "2025-12-29" });
  });

  it("MoM moves both ends back one calendar month", () => {
    expect(comparisonRange("2026-11-01", "2026-11-12", "mom")).toEqual({ from: "2026-10-01", to: "2026-10-12" });
    expect(comparisonRange("2026-01-01", "2026-01-31", "mom")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("MoM clamps to the shorter month instead of spilling over", () => {
    expect(comparisonRange("2026-03-01", "2026-03-31", "mom")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(comparisonRange("2026-03-29", "2026-03-31", "mom")).toEqual({ from: "2026-02-28", to: "2026-02-28" });
  });

  it("YoY moves back one year and handles Feb 29", () => {
    expect(comparisonRange("2026-10-14", "2026-11-12", "yoy")).toEqual({ from: "2025-10-14", to: "2025-11-12" });
    expect(comparisonRange("2024-02-01", "2024-02-29", "yoy")).toEqual({ from: "2023-02-01", to: "2023-02-28" });
  });
});

describe("helpers", () => {
  it("parseCompareMode defaults to mom", () => {
    expect(parseCompareMode("wow")).toBe("wow");
    expect(parseCompareMode("yoy")).toBe("yoy");
    expect(parseCompareMode(undefined)).toBe("mom");
    expect(parseCompareMode("nope")).toBe("mom");
  });

  it("isIsoDate rejects malformed and impossible dates", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-2-3")).toBe(false);
    expect(isIsoDate("'; drop")).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
  });

  it("pctChange is null without a baseline", () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(5, 0)).toBeNull();
  });
});

import { resolveWindow } from "./ads-dashboard-compare";

describe("resolveWindow", () => {
  const defaults = { from: "2026-10-14", to: "2026-11-12" };

  it("falls back to defaults for missing or malformed dates", () => {
    expect(resolveWindow({}, defaults)).toEqual({
      from: "2026-10-14",
      to: "2026-11-12",
      mode: "mom",
      prior: { from: "2026-09-14", to: "2026-10-12" },
    });
    expect(resolveWindow({ from: "2026-11-01' OR 1=1", to: "x" }, defaults).from).toBe("2026-10-14");
  });

  it("swaps a reversed range", () => {
    const w = resolveWindow({ from: "2026-11-10", to: "2026-11-01", compare: "wow" }, defaults);
    expect([w.from, w.to]).toEqual(["2026-11-01", "2026-11-10"]);
    expect(w.prior).toEqual({ from: "2026-10-25", to: "2026-11-03" });
  });
});

describe("describeChange", () => {
  it("never prints an explosive percentage against a near-zero baseline", () => {
    // McDougall: 179 against 1 is +17,800%.
    expect(describeChange(179, 1)).toEqual({ kind: "na" });
    expect(describeChange(11, 1)).toEqual({ kind: "na" });
    expect(describeChange(10.9, 1)).toEqual({ kind: "pct", pct: expect.closeTo(990, 5) });
  });

  it("calls a zero or absent baseline new, not a percentage", () => {
    expect(describeChange(5, 0)).toEqual({ kind: "new" });
    expect(describeChange(5, null)).toEqual({ kind: "new" });
    expect(describeChange(0, 0)).toEqual({ kind: "none" });
  });

  it("keeps ordinary changes, including a drop to zero", () => {
    expect(describeChange(150, 100)).toEqual({ kind: "pct", pct: 50 });
    expect(describeChange(0, 100)).toEqual({ kind: "pct", pct: -100 });
    expect(describeChange(100.2, 100)).toEqual({ kind: "none" });
    expect(describeChange(5, Number.NaN)).toEqual({ kind: "na" });
  });
});

describe("window coverage", () => {
  it("lists every date of an inclusive range, across a DST change and a year end", () => {
    expect(eachIsoDate("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
    expect(eachIsoDate("2026-12-31", "2027-01-01")).toEqual(["2026-12-31", "2027-01-01"]);
    expect(eachIsoDate("2026-10-14", "2026-11-12")).toHaveLength(30);
    expect(eachIsoDate("2026-11-02", "2026-11-01")).toEqual([]);
  });

  it("is fully synced only when every day carries a marker", () => {
    expect(isFullySynced({ syncedDays: 30, totalDays: 30 })).toBe(true);
    expect(isFullySynced({ syncedDays: 29, totalDays: 30 })).toBe(false);
    expect(isFullySynced({ syncedDays: 0, totalDays: 30 })).toBe(false);
    expect(isFullySynced({ syncedDays: 0, totalDays: 0 })).toBe(false);
  });
});
