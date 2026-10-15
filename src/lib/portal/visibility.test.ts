import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HIDDEN_TAGS,
  inRange,
  isClientVisible,
  isPortalMonth,
  monthAnchor,
  portalMonthRange,
} from "./visibility";
import { toIsoDateEastern } from "@/lib/date-utils";

afterEach(() => vi.useRealTimers());

const base = {
  effectiveStatus: "pending",
  effectiveOpportunity: false,
  needsReview: false,
  hasStatusOverride: false,
  statusTagMatched: null as string | null,
};

describe("isClientVisible", () => {
  it("hides exactly the six non-terminal tags", () => {
    expect([...HIDDEN_TAGS]).toEqual(["Lost", "Rejected", "No Case", "Referred out", "No Contact", "Declined"]);
  });

  it.each([
    ["signed", { effectiveStatus: "signed", statusTagMatched: "Signed" }, true],
    ["opportunity, pending", { effectiveOpportunity: true, statusTagMatched: "Pending" }, true],
    ["opportunity with no matched tag", { effectiveOpportunity: true }, true],
    ["pending only — neither signed nor opportunity", { statusTagMatched: "Pending" }, false],
    ["signed but needs_review", { effectiveStatus: "signed", needsReview: true }, false],
    ["opportunity but needs_review", { effectiveOpportunity: true, needsReview: true }, false],
  ])("%s -> %s", (_label, over, expected) => {
    expect(isClientVisible({ ...base, ...over })).toBe(expected);
  });

  it.each(HIDDEN_TAGS.map((t) => [t]))("an opportunity tagged %s is hidden", (tag) => {
    expect(isClientVisible({ ...base, effectiveOpportunity: true, statusTagMatched: tag })).toBe(false);
  });

  // C7: an explicit status override beats the hidden-tag rule.
  it.each(HIDDEN_TAGS.map((t) => [t]))("an admin override beats the %s tag", (tag) => {
    expect(
      isClientVisible({ ...base, effectiveStatus: "signed", hasStatusOverride: true, statusTagMatched: tag }),
    ).toBe(true);
    expect(
      isClientVisible({
        ...base,
        effectiveStatus: "pending",
        effectiveOpportunity: true,
        hasStatusOverride: true,
        statusTagMatched: tag,
      }),
    ).toBe(true);
  });

  it("an override does NOT beat needs_review", () => {
    expect(
      isClientVisible({ ...base, effectiveStatus: "signed", hasStatusOverride: true, needsReview: true }),
    ).toBe(false);
  });

  it("an override to pending with no opportunity is still not visible", () => {
    expect(isClientVisible({ ...base, hasStatusOverride: true, statusTagMatched: "Signed" })).toBe(false);
  });
});

describe("monthAnchor", () => {
  const occurredAt = new Date("2026-09-28T15:00:00Z");
  const signedAt = new Date("2026-10-03T15:00:00Z");
  it("a signed lead belongs to its signed month", () => {
    expect(monthAnchor({ effectiveStatus: "signed", signedAt, occurredAt })).toBe(signedAt);
  });
  it("a signed lead with no signed date falls back to the call date", () => {
    expect(monthAnchor({ effectiveStatus: "signed", signedAt: null, occurredAt })).toBe(occurredAt);
  });
  it("anything else belongs to its call month, even if a signed_at exists", () => {
    expect(monthAnchor({ effectiveStatus: "pending", signedAt, occurredAt })).toBe(occurredAt);
  });
});

describe("portalMonthRange", () => {
  it("is the Eastern month as a half-open range (EDT)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T15:00:00Z"));
    const r = portalMonthRange("current");
    expect(r.key).toBe("2026-10");
    expect(r.start.toISOString()).toBe("2026-10-01T04:00:00.000Z");
    expect(r.endExclusive.toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });

  // The case the spec names: 23:30 Eastern on the last day of a month is
  // already the next day in UTC, and must stay in its own month.
  it("keeps a 23:30 Eastern lead on Oct 31 in October, not November", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T20:00:00Z"));
    const r = portalMonthRange("current");
    const lateOct31 = new Date("2026-11-01T03:30:00Z"); // 23:30 EDT, Oct 31
    expect(toIsoDateEastern(lateOct31)).toBe("2026-10-31");
    expect(inRange(lateOct31, r)).toBe(true);
    expect(inRange(new Date("2026-11-01T04:30:00Z"), r)).toBe(false); // 00:30 EDT, Nov 1
  });

  it("crosses the EST/EDT change correctly (November ends in EST)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-15T15:00:00Z"));
    const r = portalMonthRange("current");
    expect(r.start.toISOString()).toBe("2026-11-01T04:00:00.000Z"); // still EDT at midnight Nov 1
    expect(r.endExclusive.toISOString()).toBe("2026-12-01T05:00:00.000Z"); // EST
  });

  it("previous month rolls back across a year boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T15:00:00Z"));
    const r = portalMonthRange("previous");
    expect(r.key).toBe("2025-12");
    expect(r.start.toISOString()).toBe("2025-12-01T05:00:00.000Z");
    expect(r.endExclusive.toISOString()).toBe("2026-01-01T05:00:00.000Z");
  });

  it("uses the Eastern month while UTC has already rolled over", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T02:00:00Z")); // Oct 31, 22:00 EDT
    expect(portalMonthRange("current").key).toBe("2026-10");
  });
});

describe("isPortalMonth", () => {
  it.each(["current", "previous"])("accepts %s", (v) => {
    expect(isPortalMonth(v)).toBe(true);
  });
  // Only two months are ever offered, so a free-form value from a URL can
  // never reach the date arithmetic.
  it.each(["2026-10", "next", "", null, undefined, 3])("rejects %s", (v) => {
    expect(isPortalMonth(v)).toBe(false);
  });
});
