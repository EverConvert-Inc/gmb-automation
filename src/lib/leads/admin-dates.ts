// Month handling for the admin surface, in EASTERN.
//
// Built on date-utils' Eastern helpers rather than beside them: a month
// boundary read in UTC is a day out for anything timestamped between 20:00
// ET and midnight, which is how a signed case landed in the wrong month once
// already. Nothing here calls toISOString().slice(0, 10).

import { firstOfMonthIsoEastern, toIsoDateEastern } from "@/lib/date-utils";

/** "YYYY-MM" for the current Eastern month. */
export function currentMonthKeyEastern(): string {
  return firstOfMonthIsoEastern().slice(0, 7);
}

export function isMonthKey(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** First and last Eastern calendar day of the month, inclusive. */
export function monthRangeEastern(monthKey: string): {
  fromIso: string;
  toIso: string;
} {
  const [year, month] = monthKey.split("-").map(Number);
  // Day 0 of the NEXT month is the last day of this one, and this is pure
  // calendar arithmetic on integers rather than on an instant, so there is
  // no zone to get wrong.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return {
    fromIso: `${year}-${mm}-01`,
    toIso: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

/** Most recent months first, starting at the current Eastern month. */
export function recentMonthKeys(count: number): string[] {
  const [year, month] = currentMonthKeyEastern().split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(Date.UTC(year, month - 1 - i, 1));
    out.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
    );
  }
  return out;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function formatMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/** An instant as its EASTERN calendar date — never its UTC one. */
export function formatEasternDate(value: Date | null): string {
  return value ? toIsoDateEastern(value) : "—";
}

/** An instant as an Eastern date and time, for the admin tables. */
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatEasternDateTime(value: Date | null): string {
  return value ? dateTimeFormatter.format(value) : "—";
}
