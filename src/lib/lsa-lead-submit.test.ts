import { describe, expect, it, afterEach } from "vitest";
import { submissionEnabled, dailyCapPerClient } from "./lsa-lead-submit";

const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
});

describe("kill switch", () => {
  it("is OFF unless the env var is exactly 'true'", () => {
    delete process.env.LSA_LEAD_RATING_SUBMIT;
    expect(submissionEnabled()).toBe(false);
    for (const v of ["", "false", "1", "yes", "TRUE", "True"]) {
      process.env.LSA_LEAD_RATING_SUBMIT = v;
      expect(submissionEnabled()).toBe(false);
    }
    process.env.LSA_LEAD_RATING_SUBMIT = "true";
    expect(submissionEnabled()).toBe(true);
  });
});

describe("daily cap", () => {
  it("defaults to 25 and rejects nonsense values", () => {
    delete process.env.LSA_LEAD_RATING_DAILY_CAP;
    expect(dailyCapPerClient()).toBe(25);
    for (const v of ["0", "-5", "abc", ""]) {
      process.env.LSA_LEAD_RATING_DAILY_CAP = v;
      expect(dailyCapPerClient()).toBe(25);
    }
    process.env.LSA_LEAD_RATING_DAILY_CAP = "3";
    expect(dailyCapPerClient()).toBe(3);
  });
});
