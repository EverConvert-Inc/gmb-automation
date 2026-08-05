import { describe, expect, it } from "vitest";
import { adjustRollupReal, adjustTagCategoryBreakdown } from "./lsa-sync";

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
