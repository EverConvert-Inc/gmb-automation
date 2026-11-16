// Pure logic for the Ads Dashboard's account-health overview (/ads): the
// budget roll-up, pacing, and the rules deciding which accounts need
// attention. No I/O.
//
// Impression share is deliberately NOT rolled up here. Google reports it at
// account level, and an impression-weighted roll-up of campaign rows was
// checked live and found badly off (22% against a true 51% lost to budget)
// because Performance Max impressions skew the weighting.

export type BudgetCampaignRow = {
  campaignId: string;
  campaignName: string;
  status: string; // ENABLED | PAUSED | REMOVED
  channel: string; // SEARCH | PERFORMANCE_MAX | ...
  budgetId: string;
  amountMicros: number | null;
  period: string; // DAILY | CUSTOM_PERIOD | ...
  explicitlyShared: boolean | null;
};

export type BudgetRollup = {
  // One entry per distinct budget that an ENABLED campaign draws on.
  budgets: Array<{
    budgetId: string;
    amount: number | null; // account currency, per `period`
    period: string;
    explicitlyShared: boolean | null;
    enabledCampaigns: string[];
  }>;
  // Sum of DAILY budgets, each budget counted once however many campaigns
  // share it.
  dailyBudget: number;
  // The same sum counted once per campaign — what a naive roll-up gives.
  // Differs from dailyBudget exactly when a budget is shared.
  naiveDailyBudget: number;
  sharedBudgetCount: number;
  // Budgets left out of dailyBudget: not DAILY, or no amount.
  excludedBudgetCount: number;
};

// A budget only constrains spend through campaigns that are running, so
// paused and removed campaigns are ignored. This reads current state, which
// is right for a budget (Google keeps no budget history in these fields).
export function rollupBudgets(rows: BudgetCampaignRow[]): BudgetRollup {
  const byBudget = new Map<string, BudgetRollup["budgets"][number]>();
  let naive = 0;
  for (const r of rows) {
    if (r.status !== "ENABLED" || !r.budgetId) continue;
    const amount = r.amountMicros === null ? null : r.amountMicros / 1_000_000;
    if (r.period === "DAILY" && amount !== null) naive += amount;
    const b = byBudget.get(r.budgetId) ?? {
      budgetId: r.budgetId,
      amount,
      period: r.period,
      explicitlyShared: r.explicitlyShared,
      enabledCampaigns: [],
    };
    b.enabledCampaigns.push(r.campaignName);
    byBudget.set(r.budgetId, b);
  }
  const budgets = Array.from(byBudget.values());
  const counted = budgets.filter((b) => b.period === "DAILY" && b.amount !== null);
  return {
    budgets,
    dailyBudget: counted.reduce((n, b) => n + (b.amount ?? 0), 0),
    naiveDailyBudget: naive,
    sharedBudgetCount: budgets.filter((b) => b.enabledCampaigns.length > 1).length,
    excludedBudgetCount: budgets.length - counted.length,
  };
}

export type Pacing = {
  expected: number; // daily budget x days elapsed
  spend: number;
  // spend / expected: 1 = on budget, below 1 = underspending. Null when
  // there is no budget to pace against.
  ratio: number | null;
};

export function pacing(dailyBudget: number, spend: number, daysElapsed: number): Pacing {
  const expected = dailyBudget * daysElapsed;
  return { expected, spend, ratio: expected > 0 ? spend / expected : null };
}

// Month to date for the month `through` falls in. Anchoring on the through
// date (yesterday when the cron runs) means the 1st of a month still
// reports the whole previous month and never an empty window.
export function monthToDateWindow(through: string): {
  monthStart: string;
  through: string;
  daysElapsed: number;
} {
  return {
    monthStart: `${through.slice(0, 7)}-01`,
    through,
    daysElapsed: Number(through.slice(8, 10)),
  };
}

// An ISO date moved by whole days (pure calendar arithmetic).
export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

// Whole days from one ISO date to another (b - a).
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Triage
// ---------------------------------------------------------------------------
//
// The overview is a triage, not a list of thresholds crossed. Every account
// gets at most one primary issue and one secondary, a tier, and a dollar
// figure for what the primary issue touches, so different kinds of problem
// can be ranked against each other. Wording stays at the confidence the data
// supports: "non-lead" is our classification of a conversion action, and
// anything built on CallRail's Signed tags is an estimate. Things normal for this
// portfolio (no signed case yet this month, most search terms never
// converting, a third of impressions lost to rank) raise nothing.

// Starting points, not findings — tune them here and nowhere else.
export const TRIAGE = {
  // Junk conversions
  junkActShare: 0.5,
  junkActMin: 10, // junk conversions, so 5 of 5 is not an emergency
  junkWatchShare: 0.25,
  junkWatchMin: 5,
  // Pacing: average daily spend against the current daily budget
  pacingWindowDays: 7,
  pacingMinDays: 3, // days at the current budget before pacing is judged
  pacingActRatio: 1.25,
  pacingActMonthly: 500, // and at least this much a month over
  pacingWatchRatio: 1.15,
  pacingUnderRatio: 0.7,
  monthDays: 30.4, // Google's own monthly multiple of a daily budget
  // Signed cases: spend since the last one, against cost per signed case
  signedLookbackDays: 180,
  signedOwnMin: 2, // signed cases needed before an account is its own benchmark
  signedContextRatio: 1.5, // spend since the last one, in cost-per-signed terms
  // Wasted Search spend (trailing window)
  wastedWindowDays: 30,
  wastedMinDollars: 500,
  // Context
  optimizationScore: 0.8, // same bar as the optimization alert email
  outlierMargin: 0.15, // points above the portfolio median to mark a cell
  opportunityBudgetLost: 0.2,
  staleDays: 2,
} as const;

export function median(values: number[]): number | null {
  return quantile(values, 0.5);
}

// Linear-interpolated quantile; null for an empty list.
export function quantile(values: number[], q: number): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

export function junkShare(conversions: number | null, junk: number | null): number | null {
  if (conversions === null || junk === null || conversions <= 0) return null;
  return junk / conversions;
}

// --- Pacing ---------------------------------------------------------------

export type PacingDay = {
  date: string;
  dailyBudget: number; // the budget stored with that day's snapshot
  spend: number | null; // that day's spend; null on rows without it
};

export type PacingRead =
  | { judged: false; reason: "no_budget" | "too_few_days"; days: number }
  | {
      judged: true;
      days: number; // days averaged, all at the current budget
      from: string;
      avgDailySpend: number;
      dailyBudget: number;
      ratio: number;
    };

// Average daily spend against the CURRENT daily budget, over the most
// recent run of days that were stored with that same budget. Budgets here
// are edited mid-month all the time, and month-to-date spend against today's
// budget turns every cut into "overspending": after a change, only the days
// since count, and until there are enough of them pacing is not judged at
// all. `days` is newest first and may contain gaps.
export function readPacing(days: PacingDay[], currentDailyBudget: number): PacingRead {
  if (!(currentDailyBudget > 0)) return { judged: false, reason: "no_budget", days: 0 };
  const run: PacingDay[] = [];
  for (const d of days.slice(0, TRIAGE.pacingWindowDays)) {
    // A cent of tolerance: the amount passes through micros and floats.
    if (Math.abs(d.dailyBudget - currentDailyBudget) > 0.005) break;
    if (d.spend === null) break;
    run.push(d);
  }
  if (run.length < TRIAGE.pacingMinDays) {
    return { judged: false, reason: "too_few_days", days: run.length };
  }
  const avg = run.reduce((n, d) => n + (d.spend ?? 0), 0) / run.length;
  return {
    judged: true,
    days: run.length,
    from: run[run.length - 1].date,
    avgDailySpend: avg,
    dailyBudget: currentDailyBudget,
    ratio: avg / currentDailyBudget,
  };
}

// --- Inputs ---------------------------------------------------------------

export type TriageInputs = {
  // "ok" = a current snapshot exists. Anything else is a data problem and
  // nothing is judged from old numbers.
  data: "ok" | "missing" | "stale" | "failed";
  mtdSpend: number;
  conversions: number | null;
  junkConversions: number | null;
  junkActions: Array<{ name: string; conversions: number }>;
  pacing: PacingRead | null;
  // Null = no CallRail company linked.
  signed: {
    lastSignedDate: string | null; // within the lookback
    spendSinceLastSigned: number; // whole lookback when there is none
    // Lookback spend / signed cases, when the account has enough of its own.
    ownCostPerSigned: number | null;
  } | null;
  // Null = the trailing search-terms window is not fully synced, or the
  // account has no cost per conversion to hold terms against.
  wasted: { dollars: number; terms: number; share: number } | null;
  optimizationScore: number | null;
  budgetLost: number | null;
  rankLost: number | null;
};

// What "normal" looks like across the accounts on the page.
export type Portfolio = {
  costPerSigned: number | null; // median of accounts' own cost per signed
  wastedShareP75: number | null;
  budgetLostMedian: number | null;
  rankLostMedian: number | null;
};

// Every issue kind is read straight from Google Ads. The signed-case gap is
// deliberately not one: it comes from joining CallRail tags to Google spend,
// which is the least certain figure on the page, so it is shown as context
// on the row and never decides a tier or a rank.
export type IssueKind = "junk" | "pacing_over" | "pacing_under" | "wasted" | "optimization_score";

export type Issue = {
  kind: IssueKind;
  tier: "act" | "watch";
  // Dollars the issue touches, for ranking. 0 when it has no dollar reading.
  dollars: number;
  // The full sentence (hover text) and the few words shown on the row; the
  // row's own cells carry the figures, so `short` never repeats them.
  text: string;
  short: string;
};

export type Tier = "act" | "watch" | "ok" | "nodata";

export type Triage = {
  tier: Tier;
  primary: Issue | null;
  secondary: Issue | null;
  // Good news worth acting on; never raises the tier.
  opportunity: string | null;
  // A signed-case gap, as context only.
  signedContext: string | null;
  // A plain note when a figure was deliberately not judged.
  note: string | null;
  // Cells well above the portfolio's normal, for colouring only.
  marks: { budgetLost: boolean; rankLost: boolean };
};

const usd0 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const pct0 = (v: number) => `${(v * 100).toFixed(0)}%`;
// Conversions can be fractional; one decimal at most, and none when whole.
const count = (n: number) => String(Math.round(n * 10) / 10);
const shortDay = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

function junkIssue(i: TriageInputs): Issue | null {
  const share = junkShare(i.conversions, i.junkConversions);
  if (share === null || i.junkConversions === null || i.conversions === null) return null;
  const tier =
    share >= TRIAGE.junkActShare && i.junkConversions >= TRIAGE.junkActMin
      ? "act"
      : share >= TRIAGE.junkWatchShare && i.junkConversions >= TRIAGE.junkWatchMin
        ? "watch"
        : null;
  if (!tier) return null;
  // "Non-lead" is our own classification of an action (a tap, a visit),
  // not something Google reports, and the wording says so.
  const top = i.junkActions[0];
  const text = top
    ? `${top.name}: ${count(top.conversions)} of ${count(i.conversions)} conversions, an action we class as non-lead (${pct0(share)} non-lead in all).`
    : `${count(i.junkConversions)} of ${count(i.conversions)} conversions (${pct0(share)}) come from actions we class as non-lead.`;
  const short = top
    ? `${top.name} · ${count(top.conversions)} of ${count(i.conversions)} conversions`
    : `${count(i.junkConversions)} of ${count(i.conversions)} conversions`;
  return { kind: "junk", tier, dollars: i.mtdSpend * share, text, short };
}

function pacingIssue(i: TriageInputs): Issue | null {
  const p = i.pacing;
  if (!p || !p.judged) return null;
  const monthly = (p.avgDailySpend - p.dailyBudget) * TRIAGE.monthDays;
  const short = `${usd0(p.avgDailySpend)}/day on a ${usd0(p.dailyBudget)}/day budget`;
  const base = `Averaging ${usd0(p.avgDailySpend)}/day against a ${usd0(p.dailyBudget)}/day budget over the last ${p.days} days (${pct0(p.ratio)})`;
  if (p.ratio >= TRIAGE.pacingWatchRatio) {
    const act = p.ratio >= TRIAGE.pacingActRatio && monthly >= TRIAGE.pacingActMonthly;
    return {
      kind: "pacing_over",
      tier: act ? "act" : "watch",
      dollars: monthly,
      text: `${base} — about ${usd0(monthly)} a month over at this rate.`,
      short,
    };
  }
  if (p.ratio <= TRIAGE.pacingUnderRatio) {
    return {
      kind: "pacing_under",
      tier: "watch",
      dollars: -monthly,
      text: `${base} — about ${usd0(-monthly)} a month of budget unspent at this rate.`,
      short,
    };
  }
  return null;
}

// Context only. CallRail's Signed tags set against Google spend: useful to
// see, too indirect to rank on.
function signedContext(i: TriageInputs, portfolio: Portfolio): string | null {
  const s = i.signed;
  if (!s) return null;
  const own = s.ownCostPerSigned;
  const benchmark = own ?? portfolio.costPerSigned;
  if (benchmark === null || !(benchmark > 0)) return null;
  if (s.spendSinceLastSigned / benchmark < TRIAGE.signedContextRatio) return null;
  const since = s.lastSignedDate
    ? `since CallRail's last signed case (${shortDay(s.lastSignedDate)})`
    : `with no signed case in CallRail for ${TRIAGE.signedLookbackDays} days`;
  const against = own !== null ? `its own average is about ${usd0(own)}` : `accounts here average about ${usd0(benchmark)}`;
  return `About ${usd0(s.spendSinceLastSigned)} spent ${since}; ${against} per signed case.`;
}

function wastedIssue(i: TriageInputs, portfolio: Portfolio): Issue | null {
  const w = i.wasted;
  if (!w || portfolio.wastedShareP75 === null) return null;
  if (w.dollars < TRIAGE.wastedMinDollars || w.share < portfolio.wastedShareP75) return null;
  return {
    kind: "wasted",
    tier: "watch",
    dollars: w.dollars,
    short: `${w.terms} search term${w.terms === 1 ? "" : "s"} past a conversion's cost, none converted`,
    text: `${usd0(w.dollars)} (${pct0(w.share)} of Search spend) went to ${w.terms === 1 ? "1 search term that cost" : `${w.terms} search terms that each cost`} more than a conversion and produced none, last ${TRIAGE.wastedWindowDays} days.`,
  };
}

function scoreIssue(i: TriageInputs): Issue | null {
  if (i.optimizationScore === null || i.optimizationScore >= TRIAGE.optimizationScore) return null;
  return {
    kind: "optimization_score",
    tier: "watch",
    dollars: 0,
    text: `Optimization score is ${pct0(i.optimizationScore)}.`,
    short: "Low optimization score",
  };
}

const NO_DATA_TEXT: Record<Exclude<TriageInputs["data"], "ok">, string> = {
  missing: "No current account-health data.",
  stale: "Account-health data is out of date, so nothing is judged from it.",
  failed: "The last account-health sync failed and there is no current data.",
};

export function triage(i: TriageInputs, portfolio: Portfolio): Triage {
  const marks = { budgetLost: false, rankLost: false };
  if (i.data !== "ok") {
    return { tier: "nodata", primary: null, secondary: null, opportunity: null, signedContext: null, note: NO_DATA_TEXT[i.data], marks };
  }

  const junk = junkIssue(i);
  const junkEmergency = junk?.tier === "act";
  const issues = [
    junk,
    pacingIssue(i),
    // When most conversions are junk, "no conversion" says nothing about a
    // search term, so wasted spend is not judged for that account.
    junkEmergency ? null : wastedIssue(i, portfolio),
    scoreIssue(i),
  ].filter((x): x is Issue => x !== null);

  // Emergencies first; among equals, by how directly we can trust the
  // signal, then by the money it touches.
  issues.sort(compareIssues);

  const above = (v: number | null, m: number | null) => v !== null && m !== null && v >= m + TRIAGE.outlierMargin;
  marks.budgetLost = above(i.budgetLost, portfolio.budgetLostMedian);
  marks.rankLost = above(i.rankLost, portfolio.rankLostMedian);

  // Budget-limited is only worth saying where more budget would buy more of
  // something real: an account signing cases at or below the portfolio's
  // typical cost, whose conversions are not mostly junk.
  let opportunity: string | null = null;
  const own = i.signed?.ownCostPerSigned ?? null;
  if (
    !junkEmergency &&
    i.budgetLost !== null &&
    i.budgetLost >= TRIAGE.opportunityBudgetLost &&
    own !== null &&
    portfolio.costPerSigned !== null &&
    own <= portfolio.costPerSigned
  ) {
    opportunity = `Budget-limited (${pct0(i.budgetLost)} of Search impressions lost to budget) while CallRail shows cases signing at about ${usd0(own)} each.`;
  }

  let note: string | null = null;
  if (junkEmergency) note = "Wasted spend is not judged while most conversions are non-lead actions.";
  else if (i.pacing && !i.pacing.judged && i.pacing.reason === "too_few_days") {
    note = `Pacing not judged yet: ${i.pacing.days} day${i.pacing.days === 1 ? "" : "s"} recorded at the current budget (needs ${TRIAGE.pacingMinDays}).`;
  }

  const primary = issues[0] ?? null;
  return {
    tier: primary ? primary.tier : "ok",
    primary,
    secondary: issues[1] ?? null,
    opportunity,
    signedContext: signedContext(i, portfolio),
    note,
    marks,
  };
}

// How directly each kind is observed, most direct first. Conversion-action
// counts and spend against budget come straight from Google Ads; the rest
// lean on thresholds of ours.
const KIND_ORDER: Record<IssueKind, number> = {
  junk: 0,
  pacing_over: 1,
  pacing_under: 2,
  wasted: 3,
  optimization_score: 4,
};

function compareIssues(a: Issue, b: Issue): number {
  return (
    Number(b.tier === "act") - Number(a.tier === "act") ||
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    b.dollars - a.dollars
  );
}

const TIER_ORDER: Record<Tier, number> = { act: 0, watch: 1, ok: 2, nodata: 3 };

// Tier, then the kind of the primary issue (most trusted signal first),
// then the money it touches, then spend, then name.
export function compareByTriage<T extends { triage: Triage; mtdSpend: number; name: string }>(a: T, b: T): number {
  const kind = (t: Triage) => (t.primary ? KIND_ORDER[t.primary.kind] : 99);
  return (
    TIER_ORDER[a.triage.tier] - TIER_ORDER[b.triage.tier] ||
    kind(a.triage) - kind(b.triage) ||
    (b.triage.primary?.dollars ?? 0) - (a.triage.primary?.dollars ?? 0) ||
    b.mtdSpend - a.mtdSpend ||
    a.name.localeCompare(b.name)
  );
}
