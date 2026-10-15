import { describe, expect, it } from "vitest";
import { RowShapeError, assertRow, assertRowShape } from "./row-guard";

const SPEC = {
  id: "string",
  name: "string",
  isActive: "boolean",
  tagCount: "number",
} as const;

describe("assertRowShape", () => {
  it("passes a well-formed row", () => {
    expect(() =>
      assertRowShape("t", [{ id: "u", name: "Firm", isActive: true, tagCount: 0 }], SPEC),
    ).not.toThrow();
  });

  // THE regression this exists for: a count landing in the name slot, which
  // is exactly what rendered a firm called "1" with no slug, marked inactive.
  it("catches a count mapped into a string field", () => {
    expect(() =>
      assertRowShape("admin/firms", [{ id: "uuid", name: 1 }], SPEC),
    ).toThrow(RowShapeError);
  });

  it("names the field, what it wanted and what it got", () => {
    try {
      assertRowShape("admin/firms", [{ id: "uuid", name: 1 }], SPEC);
      throw new Error("should have thrown");
    } catch (err) {
      const e = err as RowShapeError;
      expect(e.field).toBe("name");
      expect(e.expected).toBe("string");
      expect(e.received).toBe("number");
      expect(e.message).toContain("admin/firms");
    }
  });

  it.each([
    ["missing field", { id: "u", isActive: true, tagCount: 0 }],
    ["null in a non-null field", { id: null, name: "x", isActive: true, tagCount: 0 }],
    ["string where a boolean belongs", { id: "u", name: "x", isActive: "yes", tagCount: 0 }],
    ["string where a number belongs", { id: "u", name: "x", isActive: true, tagCount: "0" }],
  ])("catches %s", (_label, row) => {
    expect(() => assertRowShape("t", [row], SPEC)).toThrow(RowShapeError);
  });

  it("rejects NaN as a number — a crossed numeric is often NaN", () => {
    expect(() =>
      assertRowShape("t", [{ id: "u", name: "x", isActive: true, tagCount: NaN }], SPEC),
    ).toThrow(RowShapeError);
  });

  describe("optional kinds", () => {
    it.each([[null], [undefined], ["ok"]])("accepts %s for string?", (v) => {
      expect(() => assertRowShape("t", [{ slug: v }], { slug: "string?" })).not.toThrow();
    });
    it("still rejects a wrong type for an optional field", () => {
      expect(() => assertRowShape("t", [{ slug: 7 }], { slug: "string?" })).toThrow(
        RowShapeError,
      );
    });
  });

  it("validates dates", () => {
    expect(() =>
      assertRowShape("t", [{ at: new Date() }], { at: "date" }),
    ).not.toThrow();
    expect(() =>
      assertRowShape("t", [{ at: "2026-10-15" }], { at: "date" }),
    ).toThrow(RowShapeError);
    expect(() =>
      assertRowShape("t", [{ at: new Date("nope") }], { at: "date" }),
    ).toThrow(RowShapeError);
  });

  // O(1), not O(rows): crosstalk is per-response, so every row in a crossed
  // result is wrong the same way. Walking 500 buys nothing.
  it("only inspects the first row", () => {
    const rows = [
      { id: "u", name: "ok", isActive: true, tagCount: 0 },
      { id: "u", name: 999 } as never,
    ];
    expect(() => assertRowShape("t", rows, SPEC)).not.toThrow();
  });

  it("passes an empty result — nothing to inspect", () => {
    expect(() => assertRowShape("t", [], SPEC)).not.toThrow();
  });
});

describe("assertRow", () => {
  it.each([[null], [undefined]])("passes %s", (row) => {
    expect(() => assertRow("t", row, SPEC)).not.toThrow();
  });
  it("catches a crossed single row", () => {
    expect(() => assertRow("t", { id: "u", name: 1 }, SPEC)).toThrow(RowShapeError);
  });
});
