// Comparison windows for the Ads Dashboard. Pure date-string math (no Date
// "now", no time zones): every input and output is a YYYY-MM-DD calendar
// date, already Eastern by the time it gets here.

export type CompareMode = "wow" | "mom" | "yoy";

export const COMPARE_MODES: Array<{ key: CompareMode; label: string; versus: string }> = [
  { key: "wow", label: "WoW", versus: "vs 7 days earlier" },
  { key: "mom", label: "MoM", versus: "vs a month earlier" },
  { key: "yoy", label: "YoY", versus: "vs a year earlier" },
];

export function parseCompareMode(raw: string | undefined): CompareMode {
  return raw === "wow" || raw === "yoy" ? raw : "mom";
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(s: string | undefined): s is string {
  if (!s) return false;
  const m = ISO.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s;
}

function shiftDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Same day-of-month N months back, clamped to the target month's last day
// (Mar 31 -> Feb 28/29), so a shifted date never spills into the next month.
function shiftMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, lastDay));
  return first.toISOString().slice(0, 10);
}

// The window a range is compared against: the same range moved back 7 days
// (WoW), one calendar month (MoM) or one year (YoY). Both ends move by the
// same rule, so the comparison window covers the same stretch of the
// week/month/year as the selected one.
export function comparisonRange(
  from: string,
  to: string,
  mode: CompareMode,
): { from: string; to: string } {
  if (mode === "wow") return { from: shiftDays(from, -7), to: shiftDays(to, -7) };
  const months = mode === "mom" ? -1 : -12;
  const priorFrom = shiftMonths(from, months);
  const priorTo = shiftMonths(to, months);
  // Clamping can only pull dates earlier, never reorder them, but keep the
  // range well-formed regardless.
  return { from: priorFrom <= priorTo ? priorFrom : priorTo, to: priorTo };
}

// Percent change, or null when there is no baseline to divide by.
export function pctChange(current: number, prior: number): number | null {
  if (prior === 0) return null;
  return ((current - prior) / prior) * 100;
}

export type AdsDashboardWindow = {
  from: string;
  to: string;
  mode: CompareMode;
  prior: { from: string; to: string };
};

// Resolves a page's ?from=&to=&compare= into a validated window. Dates end
// up inside GAQL strings, so anything that isn't a real YYYY-MM-DD date is
// replaced by the default rather than passed through.
export function resolveWindow(
  params: { from?: string; to?: string; compare?: string },
  defaults: { from: string; to: string },
): AdsDashboardWindow {
  let from = isIsoDate(params.from) ? params.from : defaults.from;
  let to = isIsoDate(params.to) ? params.to : defaults.to;
  if (from > to) [from, to] = [to, from];
  const mode = parseCompareMode(params.compare);
  return { from, to, mode, prior: comparisonRange(from, to, mode) };
}
