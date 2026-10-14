import { afterEach, describe, expect, it, vi } from "vitest";
import {
  daysAgoIsoEastern,
  easternWallClockToDate,
  firstOfMonthIsoEastern,
  firstOfPreviousMonthIsoEastern,
  lastDayOfPreviousMonthIsoEastern,
  toIsoDateEastern,
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

  it("agrees with naive UTC math outside the risk window — matches this app's real fixed cron schedule (11:00-11:20 UTC), so regular daily syncs see zero change", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T11:10:00Z"));

    const naiveUtcYesterday = new Date("2026-07-30T11:10:00Z");
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

// Guards the true-sign-date correction in lsa-sync.ts, which reads
// call_signed_events.signed_at. These are real stored instants, so reading
// them as UTC put any case tagged after 20:00 ET on the following day.
describe("toIsoDateEastern", () => {
  it("puts a 01:10 UTC instant on the PREVIOUS Eastern day (the real Weinstein case)", () => {
    // 2026-10-07T01:10:40Z === 2026-10-06 21:10 EDT
    const signedAt = new Date("2026-10-07T01:10:40.671Z");
    expect(signedAt.toISOString().slice(0, 10)).toBe("2026-10-07"); // old behaviour
    expect(toIsoDateEastern(signedAt)).toBe("2026-10-06"); // fixed
  });

  it("handles the EDT evening boundary either side of midnight ET", () => {
    expect(toIsoDateEastern(new Date("2026-10-07T03:59:00Z"))).toBe("2026-10-06"); // 23:59 ET
    expect(toIsoDateEastern(new Date("2026-10-07T04:00:00Z"))).toBe("2026-10-07"); // 00:00 ET
  });

  it("handles the EST evening boundary (UTC-5, winter)", () => {
    expect(toIsoDateEastern(new Date("2026-01-15T04:59:00Z"))).toBe("2026-01-14"); // 23:59 EST
    expect(toIsoDateEastern(new Date("2026-01-15T05:00:00Z"))).toBe("2026-01-15"); // 00:00 EST
  });

  it("crosses a month boundary correctly", () => {
    // 23:30 ET on Oct 31 is already Nov 1 in UTC
    expect(toIsoDateEastern(new Date("2026-11-01T03:30:00Z"))).toBe("2026-10-31");
  });

  it("leaves a midday instant on the same day under both readings", () => {
    const midday = new Date("2026-10-06T16:13:45Z");
    expect(toIsoDateEastern(midday)).toBe("2026-10-06");
    expect(midday.toISOString().slice(0, 10)).toBe("2026-10-06");
  });
});

describe("easternWallClockToDate", () => {
  // Google Ads returns creation_date_time as a bare account-local wall clock.
  // Appending "Z" to it was storing every lead 4-5 hours early.
  it("reads a summer wall clock as EDT (UTC-4), not UTC", () => {
    const d = easternWallClockToDate("2026-10-13 12:12:30") as Date;
    expect(d.toISOString()).toBe("2026-10-13T16:12:30.000Z");
    // The old behaviour, for contrast.
    expect(new Date("2026-10-13T12:12:30Z").toISOString()).toBe("2026-10-13T12:12:30.000Z");
  });

  it("reads a winter wall clock as EST (UTC-5), not UTC", () => {
    const d = easternWallClockToDate("2026-01-15 12:00:00") as Date;
    expect(d.toISOString()).toBe("2026-01-15T17:00:00.000Z");
  });

  it("accepts both the space and the T separator", () => {
    expect((easternWallClockToDate("2026-10-13T12:12:30") as Date).toISOString()).toBe(
      "2026-10-13T16:12:30.000Z",
    );
  });

  // The midnight case the snapshot lookup depends on: a late-evening Eastern
  // lead must not drift onto the next Eastern day after the round trip.
  it("round-trips a 23:50 ET lead back to the same Eastern date", () => {
    const d = easternWallClockToDate("2026-10-12 23:50:00") as Date;
    expect(d.toISOString()).toBe("2026-10-13T03:50:00.000Z"); // already Oct 13 in UTC
    expect(toIsoDateEastern(d)).toBe("2026-10-12"); // still Oct 12 in Eastern
  });

  it("round-trips 00:10 ET without slipping to the previous day", () => {
    const d = easternWallClockToDate("2026-10-13 00:10:00") as Date;
    expect(toIsoDateEastern(d)).toBe("2026-10-13");
  });

  it("keeps an Eastern month boundary on the Eastern side", () => {
    const d = easternWallClockToDate("2026-10-31 23:30:00") as Date;
    expect(d.toISOString()).toBe("2026-11-01T03:30:00.000Z");
    expect(toIsoDateEastern(d)).toBe("2026-10-31");
  });

  // DST transitions: the offset must come from tzdata, not a fixed -4/-5.
  it("uses the correct offset either side of the spring-forward boundary", () => {
    // 2026-03-08: EST until 02:00, EDT after.
    expect((easternWallClockToDate("2026-03-08 01:30:00") as Date).toISOString()).toBe(
      "2026-03-08T06:30:00.000Z", // UTC-5
    );
    expect((easternWallClockToDate("2026-03-08 03:30:00") as Date).toISOString()).toBe(
      "2026-03-08T07:30:00.000Z", // UTC-4
    );
  });

  it("uses the correct offset either side of the fall-back boundary", () => {
    // 2026-11-01: EDT until 02:00, EST after.
    expect((easternWallClockToDate("2026-11-01 00:30:00") as Date).toISOString()).toBe(
      "2026-11-01T04:30:00.000Z", // UTC-4
    );
    expect((easternWallClockToDate("2026-11-01 03:30:00") as Date).toISOString()).toBe(
      "2026-11-01T08:30:00.000Z", // UTC-5
    );
  });

  it("resolves a nonexistent spring-forward wall clock to a real instant", () => {
    // 02:30 on 2026-03-08 never happens in Eastern. Must not throw or NaN.
    const d = easternWallClockToDate("2026-03-08 02:30:00");
    expect(d).toBeInstanceOf(Date);
    expect(Number.isNaN((d as Date).getTime())).toBe(false);
  });

  it("returns null for anything it cannot parse", () => {
    for (const v of ["", "not a date", "2026-10-13", "13/10/2026 12:00:00"]) {
      expect(easternWallClockToDate(v)).toBeNull();
    }
  });
});
