import { describe, expect, it } from "vitest";
import {
  PG_FOREIGN_KEY_VIOLATION,
  PG_UNIQUE_VIOLATION,
  normalizeCompanyId,
  normalizeTagName,
  pgErrorCode,
  slugify,
} from "./firm-admin";
import { buildRoutingIndex, resolveFirmsForLead } from "./routing";

describe("normalizeTagName", () => {
  it.each([
    ["Smith Law", "Smith Law", "smith law"],
    ["  Smith Law  ", "Smith Law", "smith law"],
    ["Smith   Law", "Smith Law", "smith law"],
    ["SMITH LAW", "SMITH LAW", "smith law"],
    ["Smith\tLaw", "Smith Law", "smith law"],
  ])("%s -> %s / %s", (raw, tagName, tagNameLower) => {
    expect(normalizeTagName(raw)).toEqual({ tagName, tagNameLower });
  });

  // The DB carries CHECK (tag_name_lower = lower(tag_name)). If this ever
  // stopped holding, every tag insert would be rejected at write time.
  it.each([
    "Smith Law",
    "  Spaced  Out  ",
    "MiXeD CaSe",
    "Peña Law",
    "O'Brien & Sons",
  ])("satisfies the DB check constraint for %s", (raw) => {
    const { tagName, tagNameLower } = normalizeTagName(raw);
    expect(tagNameLower).toBe(tagName.toLowerCase());
  });

  // The stored form has to be the form routing.ts will match on.
  it("produces a value the router matches, however it was typed", () => {
    const { tagName } = normalizeTagName("  smith   LAW ");
    const index = buildRoutingIndex([{ firmId: "f1", tagName }], []);
    for (const typed of ["Smith Law", "smith law", "SMITH  LAW"]) {
      expect(resolveFirmsForLead({ tags: [typed] }, index).firmIds).toEqual(["f1"]);
    }
  });
});

describe("slugify", () => {
  it.each([
    ["Smith Law Group", "smith-law-group"],
    ["  Smith  Law  ", "smith-law"],
    ["Smith & Jones, LLC", "smith-jones-llc"],
    ["Peña Law", "pena-law"],
    ["---Weird---", "weird"],
    ["Smith Law 2026", "smith-law-2026"],
  ])("%s -> %s", (raw, expected) => {
    expect(slugify(raw)).toBe(expected);
  });

  it("never ends in a separator, even after truncation", () => {
    const long = `${"a".repeat(63)} tail`;
    const slug = slugify(long);
    expect(slug.length).toBeLessThanOrEqual(64);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("returns an empty string when nothing survives", () => {
    expect(slugify("!!!")).toBe("");
  });
});

describe("normalizeCompanyId", () => {
  it("trims but never changes case — CallRail ids are opaque", () => {
    expect(normalizeCompanyId("  COMabc123  ")).toBe("COMabc123");
    expect(normalizeCompanyId("COMabc123")).toBe("COMabc123");
  });
});

describe("pgErrorCode", () => {
  it.each([
    [{ code: PG_UNIQUE_VIOLATION }, "23505"],
    [{ code: PG_FOREIGN_KEY_VIOLATION }, "23503"],
  ])("reads the SQLSTATE off %s", (err, expected) => {
    expect(pgErrorCode(err)).toBe(expected);
  });

  it.each([[new Error("boom")], [null], [undefined], ["string"], [{ code: 500 }]])(
    "returns null for %s, so a real error is never mistaken for a 4xx",
    (err) => {
      expect(pgErrorCode(err)).toBeNull();
    },
  );
});
