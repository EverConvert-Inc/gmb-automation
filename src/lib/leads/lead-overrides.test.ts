import { describe, expect, it } from "vitest";
import {
  LEAD_STATUSES,
  LeadOverridePatch,
  WRITABLE_OVERRIDE_COLUMNS,
  buildOverrideUpdate,
  shouldPromptApply,
} from "./lead-overrides";

const NOW = new Date("2026-10-14T15:00:00Z");
const lead = (over: Partial<{ suggestedStatus: string | null; statusOverride: string | null }> = {}) => ({
  suggestedStatus: null,
  statusOverride: null,
  ...over,
});

describe("the patch schema refuses to name a parsed column", () => {
  // The whole guarantee: an admin edit can never reach what CallRail said.
  it.each([
    "statusParsed",
    "nameParsed",
    "phoneParsed",
    "isOpportunityParsed",
    "statusTagMatched",
    "firmId",
    "signedAt",
    "rawNote",
    "needsReview",
  ])("rejects %s", (field) => {
    const result = LeadOverridePatch.safeParse({ [field]: "anything" });
    expect(result.success).toBe(false);
  });

  it.each([
    [{ statusOverride: "signed" }],
    [{ statusOverride: null }],
    [{ isOpportunityOverride: true }],
    [{ isOpportunityOverride: null }],
    [{ nameOverride: "Jane Doe" }],
    [{ phoneOverride: null }],
    [{ applySuggestedStatus: true }],
  ])("accepts %s", (body) => {
    expect(LeadOverridePatch.safeParse(body).success).toBe(true);
  });

  it.each(["Signed", "SIGNED", "lost", "", "opportunity"])(
    "rejects %s as a status",
    (value) => {
      expect(LeadOverridePatch.safeParse({ statusOverride: value }).success).toBe(false);
    },
  );

  it("only has the two statuses", () => {
    expect([...LEAD_STATUSES]).toEqual(["pending", "signed"]);
  });
});

describe("shouldPromptApply — Option B", () => {
  it("shows the prompt when an override exists and the tags disagree", () => {
    expect(
      shouldPromptApply({ statusOverride: "pending", suggestedStatus: "signed" }),
    ).toBe(true);
  });

  // Without an override the tag-derived status is ALREADY the effective one,
  // so there is nothing to apply.
  it.each([
    ["no override at all", { statusOverride: null, suggestedStatus: "signed" }],
    ["override agrees with the tags", { statusOverride: "signed", suggestedStatus: "signed" }],
    ["no suggestion yet", { statusOverride: "signed", suggestedStatus: null }],
    ["neither", { statusOverride: null, suggestedStatus: null }],
  ])("hides the prompt when %s", (_label, input) => {
    expect(shouldPromptApply(input)).toBe(false);
  });
});

describe("buildOverrideUpdate", () => {
  it("writes only override columns, never a parsed one", () => {
    const r = buildOverrideUpdate(
      {
        statusOverride: "signed",
        isOpportunityOverride: true,
        nameOverride: "Jane Doe",
        phoneOverride: "555-123-4567",
      },
      lead(),
      NOW,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const key of Object.keys(r.update)) {
      expect(WRITABLE_OVERRIDE_COLUMNS).toContain(key);
    }
  });

  it("treats null as CLEARING the override, not as absent", () => {
    const r = buildOverrideUpdate({ statusOverride: null }, lead({ statusOverride: "signed" }), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.update).toHaveProperty("statusOverride", null);
  });

  it("leaves an absent field untouched", () => {
    const r = buildOverrideUpdate({ nameOverride: "Jane" }, lead(), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.update).not.toHaveProperty("statusOverride");
    expect(r.update).not.toHaveProperty("phoneOverride");
  });

  it.each([["   "], [""]])("turns the blank string %s into a cleared override", (value) => {
    const r = buildOverrideUpdate({ nameOverride: value }, lead(), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.update.nameOverride).toBeNull();
  });

  it("trims a kept value", () => {
    const r = buildOverrideUpdate({ nameOverride: "  Jane Doe  " }, lead(), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.update.nameOverride).toBe("Jane Doe");
  });

  describe("applySuggestedStatus", () => {
    it("writes the suggestion into the override", () => {
      const r = buildOverrideUpdate(
        { applySuggestedStatus: true },
        lead({ suggestedStatus: "signed", statusOverride: "pending" }),
        NOW,
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.update.statusOverride).toBe("signed");
    });

    // Once the override equals the suggestion the prompt is gone — which is
    // what "clears the suggestion" means here. Nulling suggested_status
    // would just be undone by the next sync.
    it("resolves the prompt by agreement", () => {
      const r = buildOverrideUpdate(
        { applySuggestedStatus: true },
        lead({ suggestedStatus: "signed", statusOverride: "pending" }),
        NOW,
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(
        shouldPromptApply({
          statusOverride: r.update.statusOverride as string,
          suggestedStatus: "signed",
        }),
      ).toBe(false);
    });

    it("refuses when there is no suggestion", () => {
      const r = buildOverrideUpdate({ applySuggestedStatus: true }, lead(), NOW);
      expect(r).toEqual({ ok: false, error: "There is no suggested status to apply." });
    });

    it("refuses an ambiguous request that also sets the status by hand", () => {
      const r = buildOverrideUpdate(
        { applySuggestedStatus: true, statusOverride: "pending" },
        lead({ suggestedStatus: "signed" }),
        NOW,
      );
      expect(r.ok).toBe(false);
    });
  });

  it("refuses an empty patch rather than writing a bare updated_at", () => {
    expect(buildOverrideUpdate({}, lead(), NOW)).toEqual({
      ok: false,
      error: "Nothing to change.",
    });
  });
});
