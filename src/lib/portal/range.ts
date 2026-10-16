// The portal's date range: the ONE place its limits live.
//
// A client may read leads from the start of the previous Eastern month up to
// and including today (Eastern) — never a future day, never an older month.
// To widen the window later, change PORTAL_MONTHS_BACK; every check below,
// on the page, in the picker and in listVisibleLeads, derives from it.
//
// Ranges are inclusive Eastern calendar days, "YYYY-MM-DD". The instants a
// query uses are the start of `from` and the start of the day AFTER `to`,
// both Eastern, so the last day is counted whole.

import {
  easternWallClockToDate,
  firstOfMonthIsoEastern,
  firstOfPreviousMonthIsoEastern,
  lastDayOfPreviousMonthIsoEastern,
  todayIsoEastern,
} from "@/lib/date-utils";

/** How many whole months before the current one a client may see. */
export const PORTAL_MONTHS_BACK = 1;

export type PortalWindow = {
  /** First allowed day (Eastern), inclusive. */
  min: string;
  /** Last allowed day: today (Eastern), inclusive. */
  max: string;
};

export type PortalPreset = "current" | "previous";

declare const BRAND: unique symbol;

/**
 * A range that has passed parsePortalRange. Only this module can make one,
 * and listVisibleLeads accepts nothing else.
 */
export type PortalDateRange = {
  readonly from: string;
  readonly to: string;
  readonly start: Date;
  readonly endExclusive: Date;
  readonly [BRAND]: true;
};

export type RangeRefusal = "malformed" | "reversed" | "out_of_window";
export type RangeParse = { ok: true; range: PortalDateRange } | { ok: false; reason: RangeRefusal };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** "2026-10-31" → "2026-11-01". Calendar arithmetic only; no time zone involved. */
function nextIsoDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** "2026-10-01" minus n months → "2026-09-01" (n = 1). */
function monthsBefore(firstOfMonthIso: string, n: number): string {
  const [y, m] = firstOfMonthIso.split("-").map(Number);
  const index = y * 12 + (m - 1) - n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

function startOfEasternDay(iso: string): Date {
  const d = easternWallClockToDate(`${iso} 00:00:00`);
  if (!d) throw new Error(`Invalid Eastern date ${iso}`);
  return d;
}

export function allowedPortalWindow(): PortalWindow {
  return { min: monthsBefore(firstOfMonthIsoEastern(), PORTAL_MONTHS_BACK), max: todayIsoEastern() };
}

function make(from: string, to: string): PortalDateRange {
  return {
    from,
    to,
    start: startOfEasternDay(from),
    endExclusive: startOfEasternDay(nextIsoDay(to)),
  } as PortalDateRange;
}

/**
 * The only way to obtain a PortalDateRange. Accepts exactly two real
 * "YYYY-MM-DD" strings, from <= to, both inside the allowed window.
 */
export function parsePortalRange(from: unknown, to: unknown, window: PortalWindow = allowedPortalWindow()): RangeParse {
  if (typeof from !== "string" || typeof to !== "string" || !isRealIsoDate(from) || !isRealIsoDate(to)) {
    return { ok: false, reason: "malformed" };
  }
  if (from > to) return { ok: false, reason: "reversed" };
  if (from < window.min || to > window.max) return { ok: false, reason: "out_of_window" };
  return { ok: true, range: make(from, to) };
}

/** This month (to today), or all of last month. */
export function presetRange(preset: PortalPreset): PortalDateRange {
  const range =
    preset === "current"
      ? parsePortalRange(firstOfMonthIsoEastern(), todayIsoEastern())
      : parsePortalRange(firstOfPreviousMonthIsoEastern(), lastDayOfPreviousMonthIsoEastern());
  // Presets always lie inside the window while PORTAL_MONTHS_BACK >= 1.
  if (!range.ok) throw new Error(`Preset ${preset} is outside the portal window`);
  return range.range;
}

/** Which preset a range is exactly, if any. */
export function presetOf(range: { from: string; to: string }): PortalPreset | null {
  for (const p of ["current", "previous"] as const) {
    const r = presetRange(p);
    if (r.from === range.from && r.to === range.to) return p;
  }
  return null;
}

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The page's reading of its URL. `from`/`to` must BOTH be present and valid;
 * anything else — out of the window, reversed, malformed, repeated — is
 * refused (invalid: true) and the default range is used instead, so no query
 * ever runs with dates the window does not allow. `month=previous` is kept as
 * an alias for the Last month preset.
 */
export function rangeFromSearchParams(sp: SearchParams): {
  range: PortalDateRange;
  invalid: boolean;
} {
  const hasFrom = sp.from !== undefined;
  const hasTo = sp.to !== undefined;
  if (hasFrom || hasTo) {
    const parsed = parsePortalRange(sp.from, sp.to);
    return parsed.ok ? { range: parsed.range, invalid: false } : { range: presetRange("current"), invalid: true };
  }
  return { range: presetRange(sp.month === "previous" ? "previous" : "current"), invalid: false };
}

/**
 * Re-checked inside listVisibleLeads, so even a range built some other way
 * (a cast, a bug) cannot reach the query.
 */
export function assertPortalRange(range: PortalDateRange): void {
  const again = parsePortalRange(range?.from, range?.to);
  if (
    !again.ok ||
    !(range.start instanceof Date) ||
    !(range.endExclusive instanceof Date) ||
    again.range.start.getTime() !== range.start.getTime() ||
    again.range.endExclusive.getTime() !== range.endExclusive.getTime()
  ) {
    throw new Error("Portal date range is outside the allowed window.");
  }
}
