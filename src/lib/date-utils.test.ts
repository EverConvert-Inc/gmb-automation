import { afterEach, describe, expect, it, vi } from "vitest";
import {
  daysAgoIsoEastern,
  firstOfMonthIsoEastern,
  firstOfPreviousMonthIsoEastern,
  lastDayOfPreviousMonthIsoEastern,
  todayIsoEastern,
  yesterdayIsoEastern,
} from "./date-utils";

describe("date-utils — Eastern-time date boundaries", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("diverges from naive UTC math inside the risk window, during EDT (summer, UTC-4)", () => {
    // 2026-07-30T02:30:00Z = 2026-07-29 22:30 Eastern (EDT) — still the
    // previous day in Eastern, but already the next day in UTC.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T02:30:00Z"));

    expect(todayIsoEastern()).toBe("2026-07-29");
    expect(yesterdayIsoEastern()).toBe("2026-07-28");

    // What the OLD (pre-fix) UTC-based code would have computed — proves
    // this is a real, reachable divergence, not just a theoretical one.
    const naiveUtcYesterday = new Date("2026-07-30T02:30:00Z");
    naiveUtcYesterday.setUTCDate(naiveUtcYesterday.getUTCDate() - 1);
    expect(naiveUtcYesterday.toISOString().slice(0, 10)).toBe("2026-07-29");
    expect(naiveUtcYesterday.toISOString().slice(0, 10)).not.toBe(
      yesterdayIsoEastern(),
    );
  });

  it("diverges from naive UTC math inside the risk window, during EST (winter, UTC-5) — proves DST-awareness, not a fixed offset", () => {
    // 2026-01-30T03:30:00Z = 2026-01-29 22:30 Eastern (EST).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-30T03:30:00Z"));

    expect(todayIsoEastern()).toBe("2026-01-29");
    expect(yesterdayIsoEastern()).toBe("2026-01-28");

    const naiveUtcYesterday = new Date("2026-01-30T03:30:00Z");
    naiveUtcYesterday.setUTCDate(naiveUtcYesterday.getUTCDate() - 1);
    expect(naiveUtcYesterday.toISOString().slice(0, 10)).toBe("2026-01-29");
    expect(naiveUtcYesterday.toISOString().slice(0, 10)).not.toBe(
      yesterdayIsoEastern(),
    );
  });

  it("agrees with naive UTC math outside the risk window — matches this app's real fixed cron schedule (9:30-9:50 UTC), so regular daily syncs see zero change", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T09:40:00Z"));

    const naiveUtcYesterday = new Date("2026-07-30T09:40:00Z");
    naiveUtcYesterday.setUTCDate(naiveUtcYesterday.getUTCDate() - 1);

    expect(yesterdayIsoEastern()).toBe(
      naiveUtcYesterday.toISOString().slice(0, 10),
    );
    expect(yesterdayIsoEastern()).toBe("2026-07-29");
  });

  it("firstOfMonthIsoEastern() uses the Eastern-local month, not the UTC month, across a month boundary", () => {
    // 2026-08-01T02:30:00Z = 2026-07-31 22:30 Eastern — still July in
    // Eastern time, even though UTC has already rolled into August.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T02:30:00Z"));

    expect(firstOfMonthIsoEastern()).toBe("2026-07-01");
    expect(firstOfMonthIsoEastern()).not.toBe("2026-08-01");
  });

  it("daysAgoIsoEastern(30) computes 30 whole days back from the Eastern-local date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T09:40:00Z")); // Eastern: 2026-07-30

    expect(daysAgoIsoEastern(30)).toBe("2026-06-30");
  });

  it("firstOfPreviousMonthIsoEastern() rolls back a month, including a year boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T09:40:00Z")); // Eastern: 2026-07-30
    expect(firstOfPreviousMonthIsoEastern()).toBe("2026-06-01");

    vi.setSystemTime(new Date("2026-01-15T09:40:00Z")); // Eastern: 2026-01-15
    expect(firstOfPreviousMonthIsoEastern()).toBe("2025-12-01");
  });

  it("lastDayOfPreviousMonthIsoEastern() is the day before the current Eastern-local month started, including a short-February/year boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T09:40:00Z")); // Eastern: 2026-07-30
    expect(lastDayOfPreviousMonthIsoEastern()).toBe("2026-06-30");

    vi.setSystemTime(new Date("2026-01-15T09:40:00Z")); // Eastern: 2026-01-15
    expect(lastDayOfPreviousMonthIsoEastern()).toBe("2025-12-31");

    vi.setSystemTime(new Date("2026-03-15T09:40:00Z")); // Eastern: 2026-03-15
    expect(lastDayOfPreviousMonthIsoEastern()).toBe("2026-02-28");
  });

  it("firstOfPreviousMonthIsoEastern()/lastDayOfPreviousMonthIsoEastern() use the Eastern-local month across a UTC month boundary", () => {
    // 2026-08-01T02:30:00Z = 2026-07-31 22:30 Eastern — still July in
    // Eastern time, even though UTC has already rolled into August.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T02:30:00Z"));

    expect(firstOfPreviousMonthIsoEastern()).toBe("2026-06-01");
    expect(lastDayOfPreviousMonthIsoEastern()).toBe("2026-06-30");
  });
});
