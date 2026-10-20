// Which names count as usable: the pure rule, and its SQL form's text. The
// two were checked to agree on real Postgres (100 names, 0 disagreements)
// when this was written; this file pins the rule itself.
import { describe, expect, it } from "vitest";
import { SOURCE_LABEL_KEYS, UNUSABLE_NAME_KEYS, hasUsableName, isUnusableName, nameKey, unusableNameSql } from "./usable-name";

describe("isUnusableName", () => {
  it.each([["No Name"], ["no name"], ["NO NAME"], ["nO nAmE"], ["  No Name  "], ["No Name."], ["(no name)"], ["no-name"], ["no_name"], ["NoName"]])(
    "%j — the No Name placeholder",
    (name) => expect(isUnusableName(name)).toBe(true),
  );

  it.each([[""], ["   "], ["..."], ["\t"], [null], [undefined]])("%j — empty, blank or punctuation only", (name) =>
    expect(isUnusableName(name)).toBe(true),
  );

  it.each([["5551234567"], ["12345"], ["(555) 123-4567"], ["+1 555-123-4567"], ["555.123.4567"]])("%j — a number", (name) =>
    expect(isUnusableName(name)).toBe(true),
  );

  it.each([["Google Local Services Ads"], ["google local services ads "], ["Google-Local"], ["GOOGLE ADS"], ["Facebook"]])(
    "%j — a lead-source label",
    (name) => expect(isUnusableName(name)).toBe(true),
  );

  it.each([["Jane Doe"], ["Noel Namey"], ["No Name Smith"], ["Mary O'Neil"], ["José García"], ["Agent 47"], ["Google"], ["李"], ["Steven Vance"], ["Direct TV Rep"]])(
    "%j — a real name",
    (name) => expect(isUnusableName(name)).toBe(false),
  );

  it("every source label is unusable however it is spelled", () => {
    for (const k of SOURCE_LABEL_KEYS) {
      expect(isUnusableName(k)).toBe(true);
      expect(isUnusableName(` ${k.toUpperCase().replace(/ /g, "-")}. `)).toBe(true);
    }
  });
});

describe("hasUsableName", () => {
  it("a staff-typed name always counts, even a placeholder", () => {
    expect(hasUsableName({ name: "No Name", hasNameOverride: true })).toBe(true);
    expect(hasUsableName({ name: "5551234567", hasNameOverride: true })).toBe(true);
  });
  it("otherwise the name itself decides", () => {
    expect(hasUsableName({ name: "No Name", hasNameOverride: false })).toBe(false);
    expect(hasUsableName({ name: "Jane Doe", hasNameOverride: false })).toBe(true);
  });
});

describe("the SQL form", () => {
  const text = unusableNameSql("n");
  it("lists exactly the TypeScript keys", () => {
    for (const k of UNUSABLE_NAME_KEYS) expect(text).toContain(`'${k}'`);
    const literals = text.slice(text.indexOf(" in (")).match(/'[a-z ]+'/g);
    expect(literals).toHaveLength(UNUSABLE_NAME_KEYS.length);
  });
  it("uses explicit ASCII sets (no locale classes) and no \\v, which E'' does not know", () => {
    expect(text).not.toMatch(/\[:(space|punct|alnum):\]/);
    expect(text).not.toContain("\\v");
    expect(text).toContain("n is null");
  });
  it("keys are already normalised", () => {
    for (const k of UNUSABLE_NAME_KEYS) expect(nameKey(k)).toBe(k);
  });
});
