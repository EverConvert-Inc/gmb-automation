import { describe, expect, it } from "vitest";
import {
  adjustRollupReal,
  adjustTagCategoryBreakdown,
  datesInRange,
  daysBetween,
} from "./lsa-sync";

describe("adjustRollupReal — flat shape", () => {
  it("increments real on a flat object, preserving junk/unclassified", () => {
    expect(adjustRollupReal({ real: 2, junk: 1, unclassified: 0 }, null, 1)).toEqual({
      real: 3,
      junk: 1,
      unclassified: 0,
    });
  });

  it("decrements real on a flat object", () => {
    expect(adjustRollupReal({ real: 3, junk: 0, unclassified: 0 }, null, -1)).toEqual({
      real: 2,
      junk: 0,
      unclassified: 0,
    });
  });

  it("creates a flat {real:1,...} from a brand-new empty object when channel is null", () => {
    expect(adjustRollupReal({}, null, 1)).toEqual({ real: 1, junk: 0, unclassified: 0 });
  });
});

describe("adjustRollupReal — nested (channel-split) shape", () => {
  it("increments real for the given channel, preserving other channels untouched", () => {
    const current = {
      LSA: { real: 1, junk: 0, unclassified: 0 },
      GMB: { real: 5, junk: 2, unclassified: 1 },
    };
    expect(adjustRollupReal(current, "LSA", 1)).toEqual({
      LSA: { real: 2, junk: 0, unclassified: 0 },
      GMB: { real: 5, junk: 2, unclassified: 1 },
    });
  });

  it("decrements real for the given channel", () => {
    const current = { PPC: { real: 4, junk: 0, unclassified: 0 } };
    expect(adjustRollupReal(current, "PPC", -1)).toEqual({
      PPC: { real: 3, junk: 0, unclassified: 0 },
    });
  });

  it("creates a new channel key from scratch when that channel has no existing entry", () => {
    const current = { GMB: { real: 5, junk: 0, unclassified: 0 } };
    expect(adjustRollupReal(current, "PMax", 1)).toEqual({
      GMB: { real: 5, junk: 0, unclassified: 0 },
      PMax: { real: 1, junk: 0, unclassified: 0 },
    });
  });

  it("creates a nested {channel: {real:1,...}} from a brand-new empty object when channel is non-null", () => {
    expect(adjustRollupReal({}, "LSA", 1)).toEqual({
      LSA: { real: 1, junk: 0, unclassified: 0 },
    });
  });

  it("falls back to the LSA key when channel is somehow null but the existing shape is already nested", () => {
    const current = { LSA: { real: 2, junk: 0, unclassified: 0 } };
    expect(adjustRollupReal(current, null, 1)).toEqual({
      LSA: { real: 3, junk: 0, unclassified: 0 },
    });
  });
});

describe("adjustTagCategoryBreakdown — flat shape", () => {
  it("increments a label on a flat object, preserving other labels untouched", () => {
    expect(adjustTagCategoryBreakdown({ Signed: 2, Junk: 1 }, null, ["Signed"], 1)).toEqual({
      Signed: 3,
      Junk: 1,
    });
  });

  it("decrements a label on a flat object", () => {
    expect(adjustTagCategoryBreakdown({ Signed: 1 }, null, ["Signed"], -1)).toEqual({
      Signed: 0,
    });
  });

  it("adjusts multiple labels for the same call in one call", () => {
    expect(
      adjustTagCategoryBreakdown({ Signed: 1, Opportunity: 1 }, null, ["Signed", "Opportunity"], -1),
    ).toEqual({ Signed: 0, Opportunity: 0 });
  });

  it("creates a brand-new label key from an empty object when channel is null", () => {
    expect(adjustTagCategoryBreakdown({}, null, ["Signed"], 1)).toEqual({ Signed: 1 });
  });

  it("is a no-op for an empty label list, returning the same reference", () => {
    const current = { Signed: 1 };
    expect(adjustTagCategoryBreakdown(current, null, [], 1)).toBe(current);
  });
});

describe("adjustTagCategoryBreakdown — nested (channel-split) shape", () => {
  it("increments a label for the given channel, preserving other channels untouched", () => {
    const current = {
      LSA: { Signed: 1 },
      GMB: { Signed: 5, Opportunity: 2 },
    };
    expect(adjustTagCategoryBreakdown(current, "LSA", ["Signed"], 1)).toEqual({
      LSA: { Signed: 2 },
      GMB: { Signed: 5, Opportunity: 2 },
    });
  });

  it("decrements a label for the given channel", () => {
    const current = { PPC: { Opportunity: 4 } };
    expect(adjustTagCategoryBreakdown(current, "PPC", ["Opportunity"], -1)).toEqual({
      PPC: { Opportunity: 3 },
    });
  });

  it("creates a new channel key from scratch when that channel has no existing entry", () => {
    const current = { GMB: { Signed: 5 } };
    expect(adjustTagCategoryBreakdown(current, "PMax", ["Signed"], 1)).toEqual({
      GMB: { Signed: 5 },
      PMax: { Signed: 1 },
    });
  });

  it("creates a nested {channel: {label: 1}} from a brand-new empty object when channel is non-null", () => {
    expect(adjustTagCategoryBreakdown({}, "LSA", ["Signed"], 1)).toEqual({
      LSA: { Signed: 1 },
    });
  });

  it("falls back to the LSA key when channel is somehow null but the existing shape is already nested", () => {
    const current = { LSA: { Signed: 2 } };
    expect(adjustTagCategoryBreakdown(current, null, ["Signed"], 1)).toEqual({
      LSA: { Signed: 3 },
    });
  });
});

// Guards the lsa_service_snapshots capture. campaign_criterion returns
// CURRENT state only, so these two helpers decide which dates a given
// criterion pull is allowed to describe.
describe("service snapshot date helpers", () => {
  it("datesInRange is inclusive on both ends", () => {
    expect(datesInRange("2026-10-01", "2026-10-01")).toEqual(["2026-10-01"]);
    expect(datesInRange("2026-10-01", "2026-10-04")).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
  });

  it("datesInRange crosses month and year boundaries", () => {
    expect(datesInRange("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
    expect(datesInRange("2026-12-31", "2027-01-01")).toEqual(["2026-12-31", "2027-01-01"]);
  });

  it("datesInRange returns nothing when the range is inverted", () => {
    expect(datesInRange("2026-10-04", "2026-10-01")).toEqual([]);
  });

  it("daysBetween measures whole days across a DST transition", () => {
    // US DST ends 2026-11-01; these are calendar dates, not instants, so
    // the gap must stay exactly 2 regardless of the offset change.
    expect(daysBetween("2026-11-02", "2026-10-31")).toBe(2);
    expect(daysBetween("2026-10-09", "2026-10-09")).toBe(0);
    expect(daysBetween("2026-10-09", "2026-10-10")).toBe(-1);
  });

  it("daysBetween keeps the nightly case (today vs yesterday) within the 2-day allowance", () => {
    // The cron syncs yesterday but reads criteria today — a 1-day skew that
    // must stay allowed, while a month-old backfill date must not.
    expect(Math.abs(daysBetween("2026-10-09", "2026-10-08"))).toBeLessThanOrEqual(2);
    expect(Math.abs(daysBetween("2026-10-09", "2026-09-09"))).toBeGreaterThan(2);
  });
});
