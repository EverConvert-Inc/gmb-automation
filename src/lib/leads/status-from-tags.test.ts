import { describe, expect, it } from "vitest";
import {
  CLIENT_HIDDEN_STATUS_TAGS,
  STATUS_TAG_LADDER,
  isClientHiddenStatusTag,
  resolveStatusFromTags,
  resolveStatusFromText,
  type StatusTag,
} from "./status-from-tags";

describe("resolveStatusFromTags — the ladder", () => {
  it("has the ported order, which is the spec", () => {
    expect([...STATUS_TAG_LADDER]).toEqual([
      "Signed",
      "Pending",
      "Lost",
      "Rejected",
      "No Case",
      "Referred out",
      "No Contact",
      "Declined",
    ]);
  });

  // Every rung resolves to itself, and only Signed reaches the signed status.
  it.each(STATUS_TAG_LADDER.map((t) => [t]))("%s matches itself", (tag) => {
    const r = resolveStatusFromTags([tag]);
    expect(r.matchedTag).toBe(tag);
    expect(r.status).toBe(tag === "Signed" ? "signed" : "pending");
  });

  it.each([
    [["Lost", "Signed"], "Signed"],
    [["Declined", "Pending"], "Pending"],
    [["No Contact", "Lost", "Rejected"], "Lost"],
    [["Declined", "No Contact"], "No Contact"],
    [["No Case", "Referred out"], "No Case"],
  ])("%s resolves to %s — ladder order, not array order", (tags, expected) => {
    expect(resolveStatusFromTags(tags as string[]).matchedTag).toBe(expected);
  });

  it("returns pending with no matched tag when nothing on the ladder is present", () => {
    expect(resolveStatusFromTags(["Voicemail", "Spanish"])).toEqual({
      status: "pending",
      matchedTag: null,
      isOpportunity: false,
    });
  });

  it.each([[[]], [null], [undefined]])("%s is pending with no match", (tags) => {
    const r = resolveStatusFromTags(tags as string[] | null | undefined);
    expect(r).toEqual({ status: "pending", matchedTag: null, isOpportunity: false });
  });
});

describe("resolveStatusFromTags — matching", () => {
  it.each([
    ["signed", "Signed"],
    ["SIGNED", "Signed"],
    ["  Signed  ", "Signed"],
    ["no case", "No Case"],
    ["NO CASE", "No Case"],
    ["referred  out", "Referred out"],
    ["REFERRED OUT", "Referred out"],
  ])("%s is case- and whitespace-insensitive -> %s", (tag, expected) => {
    expect(resolveStatusFromTags([tag]).matchedTag).toBe(expected);
  });

  // Whole-string only. A substring match here would silently reclassify a
  // lead, which is why this is pinned.
  it.each([
    "Not Signed",
    "Signed Up",
    "Pending Review",
    "Lost Cause",
    "Case",
    "Contact",
  ])("%s does NOT match — no partial matching", (tag) => {
    expect(resolveStatusFromTags([tag]).matchedTag).toBeNull();
  });

  it("ignores non-string and empty entries without throwing", () => {
    const tags = [null, undefined, "", "   ", "Signed"] as unknown as string[];
    expect(resolveStatusFromTags(tags).matchedTag).toBe("Signed");
  });
});

describe("resolveStatusFromTags — the Opportunity flag", () => {
  it("is a PARALLEL flag: set alongside signed", () => {
    expect(resolveStatusFromTags(["Signed", "Opportunity"])).toEqual({
      status: "signed",
      matchedTag: "Signed",
      isOpportunity: true,
    });
  });

  it("is set alongside a pending-side ladder tag too", () => {
    expect(resolveStatusFromTags(["Lost", "Opportunity"])).toEqual({
      status: "pending",
      matchedTag: "Lost",
      isOpportunity: true,
    });
  });

  it("on its own leaves the status pending with no matched tag", () => {
    expect(resolveStatusFromTags(["Opportunity"])).toEqual({
      status: "pending",
      matchedTag: null,
      isOpportunity: true,
    });
  });

  it.each(["opportunity", "OPPORTUNITY", "  Opportunity  "])(
    "%s is matched case-insensitively",
    (tag) => {
      expect(resolveStatusFromTags([tag]).isOpportunity).toBe(true);
    },
  );

  it.each(["Opportunities", "Big Opportunity", "Opp"])(
    "%s does NOT set the flag",
    (tag) => {
      expect(resolveStatusFromTags([tag]).isOpportunity).toBe(false);
    },
  );
});

describe("resolveStatusFromText — a multi-person note's own status field", () => {
  it.each([
    ["Signed", "signed", "Signed"],
    ["pending", "pending", "Pending"],
    ["Lost", "pending", "Lost"],
    ["referred out", "pending", "Referred out"],
  ])("%s -> %s / %s", (text, status, matched) => {
    const r = resolveStatusFromText(text);
    expect(r.status).toBe(status);
    expect(r.matchedTag).toBe(matched);
  });

  it.each([[null], [undefined], [""], ["   "], ["Nonsense"]])(
    "%s resolves to pending with no match",
    (text) => {
      const r = resolveStatusFromText(text as string | null | undefined);
      expect(r.status).toBe("pending");
      expect(r.matchedTag).toBeNull();
    },
  );

  it("sets the opportunity flag from the status field", () => {
    expect(resolveStatusFromText("Opportunity").isOpportunity).toBe(true);
  });
});

describe("isClientHiddenStatusTag", () => {
  it("hides exactly the six non-terminal tags", () => {
    expect([...CLIENT_HIDDEN_STATUS_TAGS]).toEqual([
      "Lost",
      "Rejected",
      "No Case",
      "Referred out",
      "No Contact",
      "Declined",
    ]);
  });

  it.each(CLIENT_HIDDEN_STATUS_TAGS.map((t) => [t]))("%s is hidden", (tag) => {
    expect(isClientHiddenStatusTag(tag)).toBe(true);
  });

  it.each([["Signed"], ["Pending"]])("%s is NOT hidden", (tag) => {
    expect(isClientHiddenStatusTag(tag as StatusTag)).toBe(false);
  });

  it.each([[null], [undefined], [""]])("%s is not hidden", (tag) => {
    expect(isClientHiddenStatusTag(tag as string | null | undefined)).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isClientHiddenStatusTag("no case")).toBe(true);
    expect(isClientHiddenStatusTag("REFERRED OUT")).toBe(true);
  });

  // The reason this exists: the portal shows "signed OR opportunity", so a
  // Lost lead that also carries Opportunity would otherwise reach the firm.
  it("a Lost + Opportunity lead is hidden despite the opportunity flag", () => {
    const r = resolveStatusFromTags(["Lost", "Opportunity"]);
    expect(r.isOpportunity).toBe(true);
    expect(isClientHiddenStatusTag(r.matchedTag)).toBe(true);
  });
});
