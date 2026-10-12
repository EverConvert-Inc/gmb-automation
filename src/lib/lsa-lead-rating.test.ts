import { describe, expect, it } from "vitest";
import {
  parseClassification,
  decideRating,
  selectCallForLead,
  MATCH_WINDOW_SECONDS,
} from "./lsa-lead-rating";

describe("parseClassification", () => {
  it("accepts a well-formed classification", () => {
    const c = parseClassification('{"requested_service":"auto_accidents","classification":"GENUINE","meets_client_definition":true,"reasoning":"Car crash."}');
    expect(c).toEqual({
      requestedService: "auto_accidents",
      classification: "GENUINE",
      meetsClientDefinition: true,
      reasoning: "Car crash.",
    });
  });

  it("rejects a hallucinated classification", () => {
    expect(parseClassification('{"requested_service":"auto_accidents","classification":"PROBABLY_FINE"}')).toBeNull();
  });

  it("rejects a missing requested_service", () => {
    expect(parseClassification('{"classification":"GENUINE"}')).toBeNull();
  });

  it("recovers JSON wrapped in fences", () => {
    const c = parseClassification('```json\n{"requested_service":"UNKNOWN","classification":"SPAM","reasoning":"Silence."}\n```');
    expect(c?.classification).toBe("SPAM");
  });

  it("defaults meets_client_definition to false when the model omits it", () => {
    const c = parseClassification('{"requested_service":"UNKNOWN","classification":"GENUINE"}');
    expect(c?.meetsClientDefinition).toBe(false);
  });

  it("returns null on prose", () => {
    expect(parseClassification("this looks like a good lead")).toBeNull();
  });
});

describe("decideRating", () => {
  const enabled = ["auto_accidents", "motorcycle_accidents"];
  const genuine = (svc: string, meets = false) => ({
    requestedService: svc,
    classification: "GENUINE",
    meetsClientDefinition: meets,
    reasoning: "",
  });

  it("rates a lead SATISFIED when its service was on, even if the firm declines it", () => {
    // The real Panchenko case: an at-fault accident the firm turned down
    // while auto_accidents was switched on. Declining is not a mismatch.
    const d = decideRating(genuine("auto_accidents"), enabled);
    expect(d.answer).toBe("SATISFIED");
    expect(d.dissatisfiedReason).toBeNull();
    expect(d.serviceWasEnabled).toBe(true);
  });

  it("rates JOB_TYPE_MISMATCH when the service was not on", () => {
    const d = decideRating(genuine("dog_bites"), enabled);
    expect(d.answer).toBe("DISSATISFIED");
    expect(d.dissatisfiedReason).toBe("JOB_TYPE_MISMATCH");
    expect(d.serviceWasEnabled).toBe(false);
  });

  it("rates JOB_TYPE_MISMATCH for a matter outside the list entirely", () => {
    const d = decideRating(genuine("OTHER_NOT_LISTED"), enabled);
    expect(d.dissatisfiedReason).toBe("JOB_TYPE_MISMATCH");
  });

  it("does not guess when the subject is unclear and no definition matches", () => {
    expect(decideRating(genuine("UNKNOWN"), enabled).notJudged).toBe("service_unclear");
  });

  it("rates SATISFIED when the service is unknown but the client definition matches", () => {
    // Lead 345437040: "I need an attorney for my son and myself to get the
    // best settlement for our injuries" — an injury, no mechanism stated.
    const d = decideRating(genuine("UNKNOWN", true), enabled);
    expect(d.answer).toBe("SATISFIED");
    expect(d.notJudged).toBeNull();
    expect(d.serviceWasEnabled).toBeNull();
  });

  it("lets the enabled list win over the definition when the service IS identifiable", () => {
    // Medical malpractice: harm from treatment is deliberately outside the
    // PI definition, so it is judged purely on whether the service was on.
    const withMedMal = [...enabled, "medical_malpractice"];
    expect(decideRating(genuine("medical_malpractice", true), withMedMal)).toMatchObject({
      answer: "SATISFIED",
      serviceWasEnabled: true,
    });
    // Not enabled -> mismatch, even though the definition flag is true.
    expect(decideRating(genuine("medical_malpractice", true), enabled)).toMatchObject({
      answer: "DISSATISFIED",
      dissatisfiedReason: "JOB_TYPE_MISMATCH",
      serviceWasEnabled: false,
    });
  });

  it("does not let the definition rescue a disabled service", () => {
    const d = decideRating(genuine("dog_bites", true), enabled);
    expect(d.answer).toBe("DISSATISFIED");
    expect(d.dissatisfiedReason).toBe("JOB_TYPE_MISMATCH");
  });

  it("maps spam, solicitation, duplicate and not-ready regardless of service", () => {
    const mk = (cl: string) => ({
      requestedService: "auto_accidents",
      classification: cl,
      meetsClientDefinition: true,
      reasoning: "",
    });
    expect(decideRating(mk("SPAM"), enabled)).toMatchObject({ answer: "VERY_DISSATISFIED", dissatisfiedReason: "SPAM" });
    expect(decideRating(mk("SOLICITATION"), enabled)).toMatchObject({ answer: "VERY_DISSATISFIED", dissatisfiedReason: "SOLICITATION" });
    expect(decideRating(mk("DUPLICATE"), enabled)).toMatchObject({ answer: "DISSATISFIED", dissatisfiedReason: "DUPLICATE" });
    expect(decideRating(mk("NOT_READY_TO_BOOK"), enabled)).toMatchObject({ answer: "DISSATISFIED", dissatisfiedReason: "NOT_READY_TO_BOOK" });
  });
});

describe("selectCallForLead", () => {
  const lead = Date.UTC(2026, 8, 11, 17, 44, 50) / 1000;

  it("picks the first_call over a later redial from the same caller", () => {
    // The real 1Charlotte case: two calls 48s apart, same number.
    const calls = [
      { startTime: "2026-09-11T17:45:48.342-04:00", transcription: "b", trackerName: "LSA", firstCall: false },
      { startTime: "2026-09-11T17:45:00.476-04:00", transcription: "a", trackerName: "LSA", firstCall: true },
    ];
    const r = selectCallForLead(lead, calls);
    expect(r.call?.transcription).toBe("a");
    expect(r.ambiguous).toBe(false);
  });

  it("consumes a call so a second lead cannot claim it", () => {
    const calls = [
      { startTime: "2026-09-11T17:45:00.476-04:00", transcription: "a", trackerName: "LSA", firstCall: true },
    ];
    expect(selectCallForLead(lead, calls).call?.transcription).toBe("a");
    expect(selectCallForLead(lead, calls).call).toBeNull();
  });

  it("returns no call when nothing falls inside the window", () => {
    const calls = [
      { startTime: "2026-09-11T18:30:00.000-04:00", transcription: "x", trackerName: "LSA", firstCall: true },
    ];
    expect(selectCallForLead(lead, calls).call).toBeNull();
  });

  it("flags ambiguity only when two candidates tie on both signals", () => {
    const calls = [
      { startTime: "2026-09-11T17:44:40.000-04:00", transcription: "a", trackerName: "LSA", firstCall: true },
      { startTime: "2026-09-11T17:45:00.000-04:00", transcription: "b", trackerName: "LSA", firstCall: true },
    ];
    expect(selectCallForLead(lead, calls).ambiguous).toBe(true);
  });

  it("uses a 60 second window", () => {
    expect(MATCH_WINDOW_SECONDS).toBe(60);
  });
});
