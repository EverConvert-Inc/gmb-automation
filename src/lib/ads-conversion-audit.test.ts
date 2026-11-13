import { describe, expect, it } from "vitest";
import { auditAction, auditConversionActions, type AuditActionInput } from "./ads-conversion-audit";

const action = (over: Partial<AuditActionInput>): AuditActionInput => ({
  id: "1",
  name: "Calls from ads",
  listed: true,
  status: "ENABLED",
  type: "AD_CALL",
  category: "PHONE_CALL_LEAD",
  origin: "CALL_FROM_ADS",
  primaryForGoal: true,
  includeInConversionsMetric: true,
  conversions: 0,
  allConversions: 0,
  priorConversions: 0,
  byChannel: {},
  ...over,
});

// Shapes below are taken from the live diagnostic output of three accounts.
describe("auditAction", () => {
  it("flags a website click-to-call that is counting", () => {
    const a = auditAction(action({ name: "Website Click to Call", type: "WEBPAGE", category: "CONTACT", origin: "WEBSITE", conversions: 179 }));
    expect(a.verdict).toBe("junk_counted");
    expect(a.reasons[0]).toMatch(/tap on a phone number/);
  });

  it("flags Google-hosted clicks to call that count despite include_in_conversions_metric=false", () => {
    const a = auditAction(action({ name: "Clicks to call", type: "GOOGLE_HOSTED", category: "CONTACT", includeInConversionsMetric: false, conversions: 22 }));
    expect(a.verdict).toBe("junk_counted");
  });

  it("flags a click-to-call filed under a lead category by its name", () => {
    const a = auditAction(action({ name: "Tel: click (GTM)", type: "WEBPAGE", category: "SUBMIT_LEAD_FORM", conversions: 4 }));
    expect(a.verdict).toBe("junk_counted");
    expect(a.reasons.join(" ")).toMatch(/filed under SUBMIT_LEAD_FORM/);
  });

  it("flags primary page-view / engagement / directions actions that are idle", () => {
    for (const [name, category] of [
      ["Local actions - Website visits", "PAGE_VIEW"],
      ["Local actions - Other engagements", "ENGAGEMENT"],
      ["Local actions - Directions", "GET_DIRECTIONS"],
    ]) {
      const a = auditAction(action({ name, category, type: "GOOGLE_HOSTED", conversions: 0, allConversions: 30 }));
      expect(a.verdict, name).toBe("junk_primary_idle");
    }
  });

  it("does not flag a non-primary junk-category action that counts nothing", () => {
    const a = auditAction(action({ name: "YouTube channel subscriptions", category: "ENGAGEMENT", primaryForGoal: false }));
    expect(a.verdict).toBe("not_counting");
  });

  it("marks a non-primary action that still counted for review", () => {
    const a = auditAction(action({ name: "CallRail – Qualified", type: "UPLOAD_CLICKS", category: "QUALIFIED_LEAD", primaryForGoal: false, includeInConversionsMetric: false, conversions: 1, allConversions: 6 }));
    expect(a.verdict).toBe("review");
    expect(a.reasons[0]).toMatch(/not set as primary/);
  });

  it("marks an action missing from the account's list for review", () => {
    const a = auditAction(action({ name: "Conversation started", listed: false, status: "", type: "", category: "", primaryForGoal: null, conversions: 1 }));
    expect(a.verdict).toBe("review");
    expect(a.reasons[0]).toMatch(/not in this account's conversion-action list/);
  });

  it("passes real lead actions", () => {
    expect(auditAction(action({ conversions: 10 })).verdict).toBe("ok");
    expect(auditAction(action({ name: "Form submission", type: "WEBPAGE", category: "SUBMIT_LEAD_FORM", conversions: 11 })).verdict).toBe("ok");
    expect(auditAction(action({ name: "Lead form - Submit", category: "SUBMIT_LEAD_FORM", conversions: 0 })).verdict).toBe("not_counting");
  });

  it("asks for a look at a counted uncategorised action without calling it junk", () => {
    const a = auditAction(action({ name: "Phone Call", type: "UPLOAD_CLICKS", category: "DEFAULT", conversions: 3 }));
    expect(a.verdict).toBe("review");
  });
});

describe("auditConversionActions", () => {
  it("summarises how much of the conversion total is junk and sorts worst first", () => {
    const { actions, summary } = auditConversionActions([
      action({ id: "a", conversions: 10 }),
      action({ id: "b", name: "Website Click to Call", category: "CONTACT", type: "WEBPAGE", conversions: 179 }),
      action({ id: "c", name: "Local actions - Website visits", category: "PAGE_VIEW", conversions: 0 }),
    ]);
    expect(actions.map((a) => a.id)).toEqual(["b", "c", "a"]);
    expect(summary).toMatchObject({
      totalConversions: 189,
      junkConversions: 179,
      cleanConversions: 10,
      junkCountedActions: 1,
      junkPrimaryIdleActions: 1,
    });
    expect(summary.junkShare).toBeCloseTo(179 / 189);
  });

  it("has no junk share when nothing converted", () => {
    expect(auditConversionActions([action({})]).summary.junkShare).toBeNull();
  });
});
