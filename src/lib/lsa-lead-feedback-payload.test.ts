// Wire-level checks on the ProvideLeadFeedback payload.
//
// These exist because of a real incident: the code set
// `survey_dissatisfied.reason` instead of `survey_dissatisfied_reason`.
// Protobuf's fromObject silently drops unknown keys, so the request encoded
// cleanly with the required enum left at its default — 0 / UNSPECIFIED — and
// Google rejected every submission with "Enum value UNSPECIFIED cannot be
// used". Typecheck, lint, tests and build all passed.
//
// ProvideLeadFeedbackRequest has no validate_only field (checked against the
// v25 proto), so Google-side validation cannot be exercised without really
// rating a lead, and that write is irreversible. Encoding through the shipped
// protos is the only way to catch a dropped field before it ships.
import { describe, expect, it } from "vitest";
import { protos } from "google-ads-node";
import { buildFeedbackPayload } from "./lsa-lead-submit";

const ProvideLeadFeedbackRequest =
  protos.google.ads.googleads.v25.services.ProvideLeadFeedbackRequest;

// Round-trip through protobuf so assertions see what Google actually receives,
// not the object literal we wrote.
//
// decode(...).toObject with defaults:true, NOT toJSON(): toJSON omits fields
// sitting at their default, so a dropped enum reads as an absent key rather
// than UNSPECIFIED and the bug this file exists for slips straight through.
// Verified both ways — with toJSON the original payload passes these tests.
function onTheWire(payload: object): Record<string, unknown> {
  const msg = ProvideLeadFeedbackRequest.fromObject(payload as Record<string, never>);
  const buf = ProvideLeadFeedbackRequest.encode(msg).finish();
  return ProvideLeadFeedbackRequest.toObject(ProvideLeadFeedbackRequest.decode(buf), {
    enums: String,
    defaults: true,
    oneofs: true,
  }) as Record<string, unknown>;
}

function enumValues(decoded: Record<string, unknown>): string[] {
  const found: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") return Object.values(v).forEach(walk);
    if (typeof v === "string") found.push(v);
  };
  walk(decoded);
  return found;
}

const RESOURCE = "customers/1234567890/localServicesLeads/345392696";

describe("ProvideLeadFeedback payload reaches Google intact", () => {
  it("encodes a dissatisfied reason instead of dropping it", () => {
    const decoded = onTheWire(
      buildFeedbackPayload({
        leadResourceName: RESOURCE,
        surveyAnswer: "DISSATISFIED",
        dissatisfiedReason: "JOB_TYPE_MISMATCH",
      }),
    );
    expect(decoded.survey_dissatisfied).toEqual(
      expect.objectContaining({ survey_dissatisfied_reason: "JOB_TYPE_MISMATCH" }),
    );
    expect(decoded.survey_answer).toBe("DISSATISFIED");
  });

  it("encodes a satisfied reason instead of dropping it", () => {
    const decoded = onTheWire(
      buildFeedbackPayload({
        leadResourceName: RESOURCE,
        surveyAnswer: "SATISFIED",
        dissatisfiedReason: null,
      }),
    );
    expect(decoded.survey_satisfied).toEqual(
      expect.objectContaining({ survey_satisfied_reason: "SERVICE_RELATED" }),
    );
  });

  // The guard that would have caught the original bug on its own: a dropped
  // field name always shows up as a required enum sitting at its default.
  it.each([
    ["DISSATISFIED", "JOB_TYPE_MISMATCH"],
    ["DISSATISFIED", "SPAM"],
    ["DISSATISFIED", "DUPLICATE"],
    ["DISSATISFIED", "SOLICITATION"],
    ["DISSATISFIED", "GEO_MISMATCH"],
    ["DISSATISFIED", "NOT_READY_TO_BOOK"],
    ["SATISFIED", null],
  ])("never encodes UNSPECIFIED for %s / %s", (answer, reason) => {
    const decoded = onTheWire(
      buildFeedbackPayload({
        leadResourceName: RESOURCE,
        surveyAnswer: answer as string,
        dissatisfiedReason: reason as string | null,
      }),
    );
    expect(enumValues(decoded)).not.toContain("UNSPECIFIED");
    expect(enumValues(decoded)).not.toContain("UNKNOWN");
  });

  it("sets exactly one side of the survey_details oneof", () => {
    const dis = onTheWire(
      buildFeedbackPayload({
        leadResourceName: RESOURCE,
        surveyAnswer: "DISSATISFIED",
        dissatisfiedReason: "SPAM",
      }),
    );
    expect(dis.survey_satisfied).toBeUndefined();

    const sat = onTheWire(
      buildFeedbackPayload({
        leadResourceName: RESOURCE,
        surveyAnswer: "SATISFIED",
        dissatisfiedReason: null,
      }),
    );
    expect(sat.survey_dissatisfied).toBeUndefined();
  });

  it("keeps the lead resource name exactly as given", () => {
    const decoded = onTheWire(
      buildFeedbackPayload({
        leadResourceName: RESOURCE,
        surveyAnswer: "SATISFIED",
        dissatisfiedReason: null,
      }),
    );
    expect(decoded.resource_name).toBe(RESOURCE);
  });
});
