import { describe, expect, it, afterEach } from "vitest";
import {
  submissionEnabled,
  dailyCapPerClient,
  maxAttemptsPerLead,
  describeGoogleAdsError,
} from "./lsa-lead-submit";

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

describe("per-lead attempt cap", () => {
  it("defaults to 3 and rejects nonsense values", () => {
    delete process.env.LSA_LEAD_RATING_MAX_ATTEMPTS;
    expect(maxAttemptsPerLead()).toBe(3);
    for (const v of ["0", "-1", "abc", ""]) {
      process.env.LSA_LEAD_RATING_MAX_ATTEMPTS = v;
      expect(maxAttemptsPerLead()).toBe(3);
    }
    process.env.LSA_LEAD_RATING_MAX_ATTEMPTS = "5";
    expect(maxAttemptsPerLead()).toBe(5);
  });
});

describe("Google error text", () => {
  // err.message alone is usually just "Request contains an invalid argument."
  // The detail that identifies the field lives in the attached failure array.
  it("includes the GoogleAdsFailure detail, not just the message", () => {
    const err = Object.assign(new Error("Request contains an invalid argument."), {
      errors: [
        {
          error_code: { enum_error: "INVALID_ENUM_VALUE" },
          message: "Enum value UNSPECIFIED cannot be used.",
          location: {
            field_path_elements: [
              { field_name: "survey_dissatisfied" },
              { field_name: "survey_dissatisfied_reason" },
            ],
          },
        },
      ],
      request_id: "abc123",
    });
    const text = describeGoogleAdsError(err);
    expect(text).toContain("Request contains an invalid argument.");
    expect(text).toContain("INVALID_ENUM_VALUE");
    expect(text).toContain("survey_dissatisfied_reason");
    expect(text).toContain("abc123");
  });

  it("survives non-Error rejections and circular objects", () => {
    expect(describeGoogleAdsError("plain string")).toBe("plain string");
    expect(describeGoogleAdsError(null)).toBe("null");
    const circular: Record<string, unknown> = { code: 3 };
    circular.self = circular;
    expect(() => describeGoogleAdsError(circular)).not.toThrow();
  });
});
