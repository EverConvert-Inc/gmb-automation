import { describe, expect, it } from "vitest";
import { parseVerdict, selectCallForLead, MATCH_WINDOW_SECONDS } from "./lsa-lead-rating";

describe("parseVerdict", () => {
  it("accepts a well-formed satisfied verdict", () => {
    const v = parseVerdict('{"answer":"SATISFIED","dissatisfied_reason":null,"reasoning":"Real case."}');
    expect(v).toEqual({ answer: "SATISFIED", dissatisfiedReason: null, reasoning: "Real case." });
  });

  it("accepts a dissatisfied verdict with a valid reason", () => {
    const v = parseVerdict('{"answer":"VERY_DISSATISFIED","dissatisfied_reason":"SOLICITATION","reasoning":"Vendor."}');
    expect(v?.answer).toBe("VERY_DISSATISFIED");
    expect(v?.dissatisfiedReason).toBe("SOLICITATION");
  });

  it("rejects a hallucinated answer or reason rather than passing it through", () => {
    expect(parseVerdict('{"answer":"EXTREMELY_HAPPY","dissatisfied_reason":null}')).toBeNull();
    expect(parseVerdict('{"answer":"DISSATISFIED","dissatisfied_reason":"BAD_VIBES"}')).toBeNull();
  });

  it("rejects incoherent combinations", () => {
    // dissatisfied with no reason is not actionable
    expect(parseVerdict('{"answer":"DISSATISFIED","dissatisfied_reason":null}')).toBeNull();
    // a reason attached to a satisfied answer contradicts itself
    expect(parseVerdict('{"answer":"SATISFIED","dissatisfied_reason":"SPAM"}')).toBeNull();
  });

  it("recovers JSON wrapped in prose or fences", () => {
    const v = parseVerdict('```json\n{"answer":"NEUTRAL","dissatisfied_reason":null,"reasoning":"Thin."}\n```');
    expect(v?.answer).toBe("NEUTRAL");
  });

  it("returns null on unparseable output", () => {
    expect(parseVerdict("I think this lead is fine")).toBeNull();
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
