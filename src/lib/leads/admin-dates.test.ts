import { afterEach, describe, expect, it, vi } from "vitest";
import {
  currentMonthKeyEastern,
  formatEasternDate,
  formatEasternDateTime,
  formatMonthKey,
  isMonthKey,
  monthRangeEastern,
  recentMonthKeys,
} from "./admin-dates";

afterEach(() => vi.useRealTimers());

describe("currentMonthKeyEastern", () => {
  it("uses the EASTERN month while UTC has already rolled over", () => {
    // 2026-08-01T02:30:00Z = 2026-07-31 22:30 ET — still July in Eastern.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T02:30:00Z"));
    expect(currentMonthKeyEastern()).toBe("2026-07");
  });

  it("rolls over once Eastern midnight has passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00Z"));
    expect(currentMonthKeyEastern()).toBe("2026-08");
  });
});

describe("monthRangeEastern", () => {
  it.each([
    ["2026-10", "2026-10-01", "2026-10-31"],
    ["2026-02", "2026-02-01", "2026-02-28"],
    ["2024-02", "2024-02-01", "2024-02-29"],
    ["2026-09", "2026-09-01", "2026-09-30"],
    ["2026-12", "2026-12-01", "2026-12-31"],
    ["2026-01", "2026-01-01", "2026-01-31"],
  ])("%s -> %s..%s", (key, from, to) => {
    expect(monthRangeEastern(key)).toEqual({ fromIso: from, toIso: to });
  });
});

describe("isMonthKey", () => {
  it.each(["2026-01", "2026-12", "1999-07"])("accepts %s", (v) => {
    expect(isMonthKey(v)).toBe(true);
  });
  it.each(["2026-00", "2026-13", "2026-1", "26-01", "2026-10-01", "", null, undefined])(
    "rejects %s, so a crafted query string cannot reach the date math",
    (v) => {
      expect(isMonthKey(v as string | null)).toBe(false);
    },
  );
});

describe("recentMonthKeys", () => {
  it("counts back from the current Eastern month, across a year boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T15:00:00Z"));
    expect(recentMonthKeys(4)).toEqual(["2026-01", "2025-12", "2025-11", "2025-10"]);
  });

  it("starts from the Eastern month, not the UTC one", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T02:30:00Z")); // July in Eastern
    expect(recentMonthKeys(2)).toEqual(["2026-07", "2026-06"]);
  });
});

describe("formatting", () => {
  it("names a month", () => {
    expect(formatMonthKey("2026-10")).toBe("October 2026");
    expect(formatMonthKey("2026-01")).toBe("January 2026");
  });

  // 21:10 ET is already the NEXT day in UTC. Reading it as UTC is the bug
  // that put a signed case on the wrong day.
  it("renders the EASTERN calendar date, not the UTC one", () => {
    expect(formatEasternDate(new Date("2026-10-07T01:10:40.671Z"))).toBe("2026-10-06");
  });

  it("renders an Eastern date and time", () => {
    expect(formatEasternDateTime(new Date("2026-10-07T01:10:40.671Z"))).toContain("Oct 6");
  });

  it.each([[null]])("renders %s as a dash", (v) => {
    expect(formatEasternDate(v)).toBe("—");
    expect(formatEasternDateTime(v)).toBe("—");
  });
});
