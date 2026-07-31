// Shared date-boundary helpers for every PPC/LSA/Call Quality sync job and
// report default. CallRail's start_date/end_date and Google Ads' GAQL
// segments.date/creation_date_time are both interpreted in the account's
// own local timezone (Eastern for every client this app currently serves)
// — not UTC. Computing "yesterday"/"N days ago" in UTC and passing that
// string straight through as a query bound is wrong whenever the trigger
// happens between roughly 00:00-05:00 UTC (Eastern's own midnight hasn't
// passed yet), which is reachable via a manual "Sync Now" click at any
// time of day even though the fixed daily crons (9:30-9:50 UTC, well past
// Eastern midnight) were never actually affected.
//
// Uses Intl.DateTimeFormat with an IANA zone rather than a fixed UTC
// offset — Eastern alternates between EST (UTC-5) and EDT (UTC-4), so a
// hardcoded offset would itself be wrong for half the year. Node ships
// full ICU/tzdata, so this needs no external date library.
const ACCOUNT_TIMEZONE = "America/New_York";

// en-CA's date format is YYYY-MM-DD, matching what every caller already
// expects — no manual field reassembly needed.
const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ACCOUNT_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function toIsoDateEastern(d: Date): string {
  return dateFormatter.format(d);
}

export function todayIsoEastern(): string {
  return toIsoDateEastern(new Date());
}

export function yesterdayIsoEastern(): string {
  return daysAgoIsoEastern(1);
}

// Subtracts `days` whole days (as UTC calendar-date arithmetic on the
// underlying instant, which is timezone-agnostic for a fixed 24h*N
// duration) from now, then reads off the resulting Eastern calendar date.
// Only imprecise within the ~1-hour window of the two annual EST/EDT
// transitions themselves — an accepted, negligible residual risk rather
// than one worth a full date library to close, especially since this
// app's fixed cron schedule never runs anywhere near local midnight.
export function daysAgoIsoEastern(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return toIsoDateEastern(d);
}

// First of the CURRENT Eastern-local month — not the UTC month, which can
// disagree with Eastern near a month boundary (UTC can roll into a new
// month while it's still the last day of the prior month in Eastern time).
export function firstOfMonthIsoEastern(): string {
  const [year, month] = toIsoDateEastern(new Date()).split("-");
  return `${year}-${month}-01`;
}

// First of the PREVIOUS Eastern-local month. Built from
// firstOfMonthIsoEastern()'s already-resolved Eastern year/month — pure
// calendar arithmetic on those two integers, not a fresh `now` lookup, so
// there's no further timezone/DST edge case to worry about here.
export function firstOfPreviousMonthIsoEastern(): string {
  const [year, month] = firstOfMonthIsoEastern().split("-").map(Number);
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`;
}

// Last day of the PREVIOUS Eastern-local month — i.e. the day before the
// first of the current Eastern-local month. Built the same way: pure UTC
// calendar-date arithmetic on firstOfMonthIsoEastern()'s already-resolved
// year/month/day-1 triple (not a new `now` lookup), so it's exact with no
// DST edge cases — this UTC Date is standing in for an abstract calendar
// date, not a real Eastern instant.
export function lastDayOfPreviousMonthIsoEastern(): string {
  const [year, month] = firstOfMonthIsoEastern().split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, 1));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
