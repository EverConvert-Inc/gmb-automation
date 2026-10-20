// The client-visibility rule: Pending or Signed with no negative tag, or
// approved. Its SQL form was checked against this TypeScript form on real
// Postgres over 1,620 combinations (0 disagreements) when it was written;
// this file pins the rule and the SQL's shape.
import { describe, expect, it } from "vitest";
import {
  NEGATIVE_TAG_KEYS,
  approvalCovers,
  clientVisibility,
  clientVisibleSql,
  negativeNeedsReviewSql,
  negativeTagsOf,
  negativeTagsSql,
  tagKey,
  type ClientVisibilityInput,
} from "./visibility";

const SIX = ["Lost", "Rejected", "No Case", "Referred out", "No Contact", "Declined"];

/** A lead as the rule sees it, built from its CallRail tags. */
function lead(rawTags: string[], over: Partial<ClientVisibilityInput> & { matched?: string | null } = {}): ClientVisibilityInput {
  const statusTagMatched = over.matched !== undefined ? over.matched : rawTags.includes("Signed") ? "Signed" : rawTags.includes("Pending") ? "Pending" : null;
  return {
    effectiveStatus: statusTagMatched === "Signed" ? "signed" : "pending",
    hasStatusOverride: false,
    statusTagMatched,
    needsReview: false,
    negativeTags: negativeTagsOf({ rawTags, statusTagMatched }),
    clientApprovedAt: null,
    clientApprovedNegativeTags: [],
    ...over,
  };
}

describe("shown: Pending or Signed, nothing negative", () => {
  it("a Pending tag", () => expect(clientVisibility(lead(["Pending"]))).toEqual({ visible: true, label: "pending", approved: false }));
  it("a Signed tag", () => expect(clientVisibility(lead(["Signed"]))).toEqual({ visible: true, label: "signed", approved: false }));
  it("staff set the status to pending", () =>
    expect(clientVisibility(lead(["Opportunity"], { hasStatusOverride: true, effectiveStatus: "pending" }))).toMatchObject({ visible: true, label: "pending" }));
});

describe("not shown until approved", () => {
  it("Opportunity only", () => expect(clientVisibility(lead(["Opportunity"]))).toEqual({ visible: false, reason: "opportunity_only" }));
  it("no tag at all", () => expect(clientVisibility(lead([]))).toEqual({ visible: false, reason: "opportunity_only" }));

  it.each(SIX.flatMap((t) => [[t, "Pending"], [t, "Opportunity"], [t, "Signed"]]))("%s with %s is hidden for its negative tag", (neg, other) => {
    const v = clientVisibility(lead([other, neg]));
    expect(v).toEqual({ visible: false, reason: "negative_tag", negativeTags: [tagKey(neg)], approvedEarlier: false });
  });

  it("whatever the case or spacing", () => {
    expect(clientVisibility(lead(["Pending", " no   CASE "]))).toMatchObject({ reason: "negative_tag", negativeTags: ["no case"] });
    expect(clientVisibility(lead(["REFERRED\tOUT"]))).toMatchObject({ reason: "negative_tag", negativeTags: ["referred out"] });
  });

  it("a person's own negative note status counts too (a multi-person note)", () => {
    expect(clientVisibility(lead(["2 Person", "Signed"], { matched: "No Case", effectiveStatus: "pending" }))).toMatchObject({ reason: "negative_tag" });
  });

  it("a staff status override does NOT un-hide a negative tag", () => {
    expect(clientVisibility(lead(["Signed", "Lost"], { hasStatusOverride: true, effectiveStatus: "signed" }))).toMatchObject({ visible: false, reason: "negative_tag" });
  });

  it("under review stays hidden, approved or not", () => {
    expect(clientVisibility(lead(["Pending"], { needsReview: true }))).toEqual({ visible: false, reason: "needs_review" });
    expect(clientVisibility(lead(["Pending"], { needsReview: true, clientApprovedAt: new Date() }))).toEqual({ visible: false, reason: "needs_review" });
  });

  it("only exact tags: a lookalike is not negative", () => {
    expect(negativeTagsOf({ rawTags: ["Lostness", "No Cases", "Lost Lead"], statusTagMatched: null })).toEqual([]);
  });
});

describe("approval", () => {
  const at = new Date("2026-10-15T15:00:00Z");

  it("shows an Opportunity-only lead, as Pending", () => {
    expect(clientVisibility(lead(["Opportunity"], { clientApprovedAt: at }))).toEqual({ visible: true, label: "pending", approved: true });
  });

  it("shows a negative-tagged lead whose tags it covered; a Signed one as Signed", () => {
    expect(clientVisibility(lead(["Pending", "No Case"], { clientApprovedAt: at, clientApprovedNegativeTags: ["no case"] }))).toMatchObject({ visible: true, label: "pending" });
    expect(clientVisibility(lead(["Signed", "Lost"], { clientApprovedAt: at, clientApprovedNegativeTags: ["lost"] }))).toMatchObject({ visible: true, label: "signed" });
  });

  it("a negative tag that arrives after approval sends it back to review", () => {
    const v = clientVisibility(lead(["Pending", "No Case", "Declined"], { clientApprovedAt: at, clientApprovedNegativeTags: ["no case"] }));
    expect(v).toEqual({ visible: false, reason: "negative_tag", negativeTags: ["declined", "no case"], approvedEarlier: true });
  });

  it("a lead approved while clean, later tagged, goes back too", () => {
    expect(clientVisibility(lead(["Pending", "Lost"], { clientApprovedAt: at, clientApprovedNegativeTags: [] }))).toMatchObject({ visible: false, reason: "negative_tag" });
  });

  it("approvalCovers", () => {
    expect(approvalCovers({ clientApprovedAt: null, clientApprovedNegativeTags: ["lost"] }, ["lost"])).toBe(false);
    expect(approvalCovers({ clientApprovedAt: at, clientApprovedNegativeTags: ["lost", "declined"] }, ["lost"])).toBe(true);
  });
});

describe("the SQL forms", () => {
  it("negative keys are exactly the six, as tagKey()s", () => {
    expect(NEGATIVE_TAG_KEYS).toEqual(SIX.map((t) => t.toLowerCase()));
    for (const k of NEGATIVE_TAG_KEYS) expect(negativeTagsSql("l")).toContain(`'${k}'`);
  });

  it("read tags and the matched word, never select them", () => {
    const neg = negativeTagsSql("l");
    expect(neg).toContain("unnest(l.raw_tags)");
    expect(neg).toContain("l.status_tag_matched");
  });

  it("no array literals or casts (the portal's client does not parse arrays)", () => {
    for (const sql of [clientVisibleSql("l"), negativeNeedsReviewSql("l")]) expect(sql).not.toMatch(/\[\]|\barray\s*\[/i);
  });

  it("the visible condition is strictly boolean, and covers approval, negatives and Signed/Pending", () => {
    const sql = clientVisibleSql("l");
    expect(sql.startsWith("coalesce((")).toBe(true);
    expect(sql.trimEnd().endsWith("), false)")).toBe(true);
    expect(sql).toContain("<@ l.client_approved_negative_tags");
    expect(sql).toContain("l.status_tag_matched = 'Pending'");
    expect(sql).not.toContain("is_opportunity");
  });
});
