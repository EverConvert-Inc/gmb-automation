// Display formatting for the portal. Pure, so it is testable and safe on
// both server and client.

const DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC", // the input is already an Eastern calendar date
});

/** "2026-10-03" (an Eastern date) → "Oct 3, 2026". */
export function formatPortalDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? isoDate : DATE.format(d);
}

/** US numbers as (555) 123-4567; anything else exactly as stored. */
export function formatPortalPhone(phone: string | null): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return phone;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/** "2026-10" → "October 2026". */
export function formatPortalMonth(key: string): string {
  const d = new Date(`${key}-01T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? key
    : new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}
