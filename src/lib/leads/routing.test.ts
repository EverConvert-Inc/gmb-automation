import { describe, expect, it } from "vitest";
import { buildRoutingIndex, resolveFirmsForLead } from "./routing";

const FIRM_A = "firm-a";
const FIRM_B = "firm-b";
const FIRM_C = "firm-c";

const index = buildRoutingIndex(
  [
    { firmId: FIRM_A, tagName: "Smith Law" },
    { firmId: FIRM_A, tagName: "Smith" },
    { firmId: FIRM_B, tagName: "Jones Firm" },
    // Deliberately shared with firm A — rule 1 copies to each match.
    { firmId: FIRM_B, tagName: "Smith Law" },
    { firmId: FIRM_C, tagName: "Referral Partner" },
  ],
  [
    { firmId: FIRM_A, callrailCompanyId: "COM_A" },
    { firmId: FIRM_B, callrailCompanyId: "COM_B" },
  ],
);

describe("rule 1 — firm tags", () => {
  it("routes to the one firm that owns the tag", () => {
    expect(resolveFirmsForLead({ tags: ["Jones Firm"] }, index)).toEqual({
      firmIds: [FIRM_B],
      matchedBy: "tag",
      matchedTags: ["Jones Firm"],
    });
  });

  it("COPIES to every firm sharing one tag", () => {
    const d = resolveFirmsForLead({ tags: ["Smith Law"] }, index);
    expect(d.matchedBy).toBe("tag");
    expect(d.firmIds).toEqual([FIRM_A, FIRM_B]);
  });

  it("copies to every firm when several of the lead's tags match", () => {
    const d = resolveFirmsForLead({ tags: ["Jones Firm", "Referral Partner"] }, index);
    expect(d.firmIds).toEqual([FIRM_B, FIRM_C]);
    expect(d.matchedTags).toEqual(["Jones Firm", "Referral Partner"]);
  });

  it("does not duplicate a firm matched by two of its own tags", () => {
    const d = resolveFirmsForLead({ tags: ["Smith Law", "Smith"] }, index);
    expect(d.firmIds).toEqual([FIRM_A, FIRM_B]);
  });

  it("does not duplicate a firm that lists the same tag twice", () => {
    const dupe = buildRoutingIndex(
      [
        { firmId: FIRM_A, tagName: "Acme" },
        { firmId: FIRM_A, tagName: "acme" },
      ],
      [],
    );
    expect(resolveFirmsForLead({ tags: ["ACME"] }, dupe).firmIds).toEqual([FIRM_A]);
  });

  it.each(["smith law", "SMITH LAW", "  Smith Law  ", "Smith  Law"])(
    "matches %s ignoring case and collapsed whitespace",
    (tag) => {
      expect(resolveFirmsForLead({ tags: [tag] }, index).firmIds).toEqual([
        FIRM_A,
        FIRM_B,
      ]);
    },
  );

  // The leak this guards: "Smith" must never pick up "Smith Law"'s leads,
  // and "Smith Law Group" must never pick up "Smith Law"'s.
  it.each(["Smith Law Group", "Law", "Jones", "Smithlaw"])(
    "%s does NOT match — exact only, no partial",
    (tag) => {
      expect(resolveFirmsForLead({ tags: [tag] }, index).matchedBy).not.toBe("tag");
    },
  );

  it("ignores non-string and empty tags without throwing", () => {
    const tags = [null, undefined, "", "   ", "Jones Firm"] as unknown as string[];
    expect(resolveFirmsForLead({ tags }, index).firmIds).toEqual([FIRM_B]);
  });
});

describe("rule 2 — CallRail company mapping", () => {
  it("routes by company when no tag matches", () => {
    expect(
      resolveFirmsForLead({ tags: ["Voicemail"], callrailCompanyId: "COM_A" }, index),
    ).toEqual({ firmIds: [FIRM_A], matchedBy: "company", matchedTags: [] });
  });

  it("routes by company when the lead has no tags at all", () => {
    expect(resolveFirmsForLead({ callrailCompanyId: "COM_B" }, index).firmIds).toEqual([
      FIRM_B,
    ]);
  });

  it("is NOT reached when a tag matched — rule 1 wins", () => {
    const d = resolveFirmsForLead(
      { tags: ["Jones Firm"], callrailCompanyId: "COM_A" },
      index,
    );
    expect(d.matchedBy).toBe("tag");
    expect(d.firmIds).toEqual([FIRM_B]);
  });

  it("company ids are matched exactly, not case-insensitively", () => {
    expect(
      resolveFirmsForLead({ callrailCompanyId: "com_a" }, index).matchedBy,
    ).toBe("unassigned");
  });
});

describe("rule 3 — the admin queue", () => {
  it.each([
    [{ tags: ["Voicemail"], callrailCompanyId: "COM_UNKNOWN" }],
    [{ tags: [] as string[] }],
    [{ callrailCompanyId: null }],
    [{}],
  ])("%s is unassigned", (lead) => {
    expect(resolveFirmsForLead(lead, index)).toEqual({
      firmIds: [],
      matchedBy: "unassigned",
      matchedTags: [],
    });
  });

  it("an empty-string company id is unassigned, not a lookup for ''", () => {
    expect(resolveFirmsForLead({ callrailCompanyId: "   " }, index).matchedBy).toBe(
      "unassigned",
    );
  });
});

describe("conflicting company mappings", () => {
  const conflicted = buildRoutingIndex(
    [],
    [
      { firmId: FIRM_A, callrailCompanyId: "COM_X" },
      { firmId: FIRM_B, callrailCompanyId: "COM_X" },
      { firmId: FIRM_C, callrailCompanyId: "COM_OK" },
    ],
  );

  it("reports the conflict instead of silently picking one", () => {
    expect(conflicted.conflictingCompanyIds).toEqual(["COM_X"]);
  });

  // The DB forbids this, so reaching it means the constraint was bypassed.
  // Guessing a firm here would hand one firm's leads to another.
  it("routes a conflicted company to the admin queue, never to a guess", () => {
    expect(resolveFirmsForLead({ callrailCompanyId: "COM_X" }, conflicted)).toEqual({
      firmIds: [],
      matchedBy: "unassigned",
      matchedTags: [],
    });
  });

  it("leaves unconflicted companies working", () => {
    expect(resolveFirmsForLead({ callrailCompanyId: "COM_OK" }, conflicted).firmIds).toEqual(
      [FIRM_C],
    );
  });

  it("the same firm listed twice for one company is not a conflict", () => {
    const dupe = buildRoutingIndex(
      [],
      [
        { firmId: FIRM_A, callrailCompanyId: "COM_A" },
        { firmId: FIRM_A, callrailCompanyId: "COM_A" },
      ],
    );
    expect(dupe.conflictingCompanyIds).toEqual([]);
    expect(resolveFirmsForLead({ callrailCompanyId: "COM_A" }, dupe).firmIds).toEqual([
      FIRM_A,
    ]);
  });
});

describe("buildRoutingIndex — hygiene", () => {
  it("skips rules with a blank tag or a blank firm id", () => {
    const i = buildRoutingIndex(
      [
        { firmId: "", tagName: "Acme" },
        { firmId: FIRM_A, tagName: "   " },
        { firmId: FIRM_A, tagName: "Real" },
      ],
      [
        { firmId: "", callrailCompanyId: "COM_Z" },
        { firmId: FIRM_A, callrailCompanyId: "" },
      ],
    );
    expect(i.firmIdsByTag.size).toBe(1);
    expect(i.firmIdByCompany.size).toBe(0);
    expect(resolveFirmsForLead({ tags: ["Real"] }, i).firmIds).toEqual([FIRM_A]);
  });

  it("an empty index routes everything to the admin queue", () => {
    const empty = buildRoutingIndex([], []);
    expect(
      resolveFirmsForLead({ tags: ["Anything"], callrailCompanyId: "COM_A" }, empty)
        .matchedBy,
    ).toBe("unassigned");
  });
});
