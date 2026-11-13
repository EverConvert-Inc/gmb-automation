import { describe, expect, it } from "vitest";
import { formatImpressionShare } from "./ads-impression-share";

describe("formatImpressionShare", () => {
  it("renders Google's 0.0999 floor as <10%, never 9.99% or 10%", () => {
    expect(formatImpressionShare(0.0999)).toBe("<10%");
    expect(formatImpressionShare(0.09990000000000001)).toBe("<10%");
    expect(formatImpressionShare(0)).toBe("<10%");
  });

  it("renders real shares as whole percents", () => {
    expect(formatImpressionShare(0.1)).toBe("10%");
    expect(formatImpressionShare(0.4567)).toBe("46%");
    expect(formatImpressionShare(1)).toBe("100%");
  });

  it("renders a missing share as a dash", () => {
    expect(formatImpressionShare(null)).toBe("—");
    expect(formatImpressionShare(undefined)).toBe("—");
    expect(formatImpressionShare(Number.NaN)).toBe("—");
  });
});
