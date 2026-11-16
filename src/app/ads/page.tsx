import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, ChevronDown, CircleDollarSign, Eye, FileSignature, Siren } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { StatTile } from "@/components/ui/stat-tile";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { badgeClasses } from "@/components/ui/badge";
import { fmtConv, fmtDay, fmtInt, fmtUsd, TD, TDR, TH, THEAD, THR } from "@/components/ads-dashboard-ui";
import { TRIAGE as T, type Issue, type IssueKind, type Tier } from "@/lib/ads-account-health";
import { getAccountHealthOverview, type AccountHealthRow } from "@/lib/queries-ads-health";
import { yesterdayIsoEastern } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Ads Dashboard" };

const QUIET = "text-muted-foreground";
const ACT = "font-semibold text-red-700 dark:text-red-400";
const WATCH = "font-semibold text-amber-700 dark:text-amber-400";

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const usd0 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// Lost impression share is bounded by Google at both ends: under 10% comes
// back as 0.0999 and over 90% as 0.9001.
function fmtLost(v: number | null): string {
  if (v === null) return "—";
  if (v < 0.1) return "<10%";
  if (v > 0.9) return ">90%";
  return pct(v);
}

// A cell is coloured only when it is the subject of one of the row's two
// surfaced issues — red for an emergency, amber for a watch.
function tone(r: AccountHealthRow, ...kinds: IssueKind[]): string {
  const issue = [r.triage.primary, r.triage.secondary].find((i) => i && kinds.includes(i.kind));
  return issue ? (issue.tier === "act" ? ACT : WATCH) : QUIET;
}

// Where the evidence for an issue lives.
function issueHref(id: string, issue: Issue | null): string {
  return `/ads/${id}/${issue?.kind === "wasted" ? "search-terms" : "conversions"}`;
}

const DEFINITIONS = {
  spend: "Month-to-date cost across every campaign type in the Google Ads account, Performance Max included. Local Services Ads are a separate product and are not in this figure.",
  pacing: `Average daily spend against the current daily budget, over the most recent days recorded at that same budget (up to ${T.pacingWindowDays}). The daily budget is the sum of the daily budgets enabled campaigns draw on, a shared budget counted once. After a budget edit only the days since are averaged, and nothing is judged until there are ${T.pacingMinDays} — so a mid-month budget change never reads as overspending. Google may spend up to twice a daily budget on one day and evens it out over the month.`,
  budgetLost: "Search impression share lost to budget: the share of Search auctions the account was eligible for but did not show in because budget ran out. Google's account-level figure, month to date. Search campaigns only — Performance Max is not in it. Google reports anything under 10% as “<10%” and over 90% as “>90%”. Coloured only when well above the portfolio's median.",
  rankLost: "Search impression share lost to rank: the share of eligible Search auctions lost because Ad Rank (bid × quality) was too low. Google's account-level figure, month to date, Search campaigns only. High values are normal in this vertical, so it is coloured only when well above the portfolio's median and never raises an account on its own.",
  score: `Google's account-level optimization score, 0–100%. Google derives it from its own open recommendations, each weighted by the impact Google estimates it would have; applying OR dismissing a recommendation raises it. It measures how many of Google's suggestions are outstanding, not how the account performs — 100% usually means recommendations were applied or dismissed. Shown in colour only under ${pct(T.optimizationScore)}.`,
  conversions: "Google's “Conversions” (metrics.conversions) month to date, all campaign types: whatever the account is set up to count. The junk share is the part that came from likely-junk actions — an action is likely junk when its category or name describes a tap, visit or engagement rather than a lead: phone-number or contact-link taps (click-to-call), page views, engagements, directions requests, outbound clicks, store visits, downloads, YouTube views, cart and checkout actions. It is judged from what each action actually counted, never from its Primary flag. The Conversion audit page lists every action.",
  signed: `Signed cases from CallRail (calls and texts tagged Signed), month to date, across every channel except GMB. Beneath it: ad spend since the last signed case, looking back ${T.signedLookbackDays} days. An account is judged on that spend against its own average cost per signed case over the same ${T.signedLookbackDays} days — not on having none yet this month, which is normal.`,
  wasted: `Search spend over the last ${T.wastedWindowDays} days on search terms that each cost at least the account's own cost per conversion and produced no conversion. A term with a few clicks and no conversion is ordinary and is not counted. Search campaigns only. Not judged when conversions are mostly junk, or until the search-terms sync covers the whole ${T.wastedWindowDays} days.`,
} as const;

function Head({ children, tip, right = false, note }: { children: React.ReactNode; tip: string; right?: boolean; note?: string }) {
  return (
    <th className={right ? THR : TH}>
      <span className={cn("inline-flex items-center gap-1", right && "justify-end")}>
        {children}
        <InfoTooltip aria-label={`Definition: ${String(children)}`}>
          <span className="normal-case tracking-normal">{tip}</span>
        </InfoTooltip>
      </span>
      {note && <div className="text-[9px] font-normal normal-case tracking-normal">{note}</div>}
    </th>
  );
}

function PacingCell({ r }: { r: AccountHealthRow }) {
  const p = r.pacing;
  if (!p) return <span className={QUIET}>—</span>;
  if (!p.judged) {
    return (
      <div className={cn("text-xs", QUIET)}>
        {p.reason === "no_budget" ? "No daily budget" : "Not judged yet"}
        <div className="text-[10px]">
          {p.reason === "no_budget"
            ? "no enabled campaign has one"
            : `${p.days} of ${T.pacingMinDays} days at ${usd0(r.dailyBudget)}/day`}
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className={tone(r, "pacing_over", "pacing_under")}>{pct(p.ratio)}</div>
      <div className={cn("text-[10px]", QUIET)}>
        {usd0(p.avgDailySpend)}/day vs {usd0(p.dailyBudget)} · {p.days}d
      </div>
    </div>
  );
}

function Row({ r }: { r: AccountHealthRow }) {
  const t = r.triage;
  return (
    <tr className="align-top">
      <td className={cn(TD, "max-w-md")}>
        <Link href={issueHref(r.id, t.primary)} className="font-medium hover:underline">
          {r.name}
        </Link>
        {t.primary && (
          <p className={cn("mt-1 text-xs", t.primary.tier === "act" ? "text-foreground" : QUIET)}>
            {t.primary.text}
          </p>
        )}
        {t.secondary && <p className={cn("mt-1 text-xs", QUIET)}>Also: {t.secondary.text}</p>}
        {t.opportunity && (
          <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">{t.opportunity}</p>
        )}
        {t.note && <p className={cn("mt-1 text-[11px] italic", QUIET)}>{t.note}</p>}
        {r.lastSyncFailed && t.tier !== "nodata" && (
          <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400" title={r.lastSyncFailed}>
            The latest sync failed; figures are from {r.snapshotDate ? fmtDay(r.snapshotDate) : "an earlier run"}.
          </p>
        )}
      </td>
      <td className={cn(TDR, QUIET)}>{r.snapshotDate ? fmtUsd(r.mtdSpend) : "—"}</td>
      <td className={TDR}>
        <PacingCell r={r} />
      </td>
      <td className={cn(TDR, t.marks.budgetLost ? WATCH : QUIET)}>{fmtLost(r.budgetLost)}</td>
      <td className={cn(TDR, t.marks.rankLost ? WATCH : QUIET)}>{fmtLost(r.rankLost)}</td>
      <td className={cn(TDR, tone(r, "optimization_score"))}>
        {r.optimizationScore === null ? "—" : pct(r.optimizationScore)}
      </td>
      <td className={TDR}>
        <div className={QUIET}>{r.conversions === null ? "—" : fmtConv(r.conversions)}</div>
        {r.junkShare !== null && r.junkShare > 0 && (
          <div className={cn("text-[10px]", tone(r, "junk"))}>{pct(r.junkShare)} junk</div>
        )}
      </td>
      <td className={TDR}>
        <div className={QUIET}>{r.signedMtd === null ? "—" : fmtInt(r.signedMtd)}</div>
        <div className={cn("text-[10px]", r.signedMtd === null ? QUIET : tone(r, "signed"))}>
          {r.signedMtd === null
            ? "no CallRail"
            : r.spendSinceLastSigned === null
              ? ""
              : `${usd0(r.spendSinceLastSigned)} since last`}
        </div>
      </td>
      <td className={TDR}>
        {r.wasted ? (
          <>
            <div className={tone(r, "wasted")}>{usd0(r.wasted.dollars)}</div>
            <div className={cn("text-[10px]", QUIET)}>
              {pct(r.wasted.share)} · {r.wasted.terms} term{r.wasted.terms === 1 ? "" : "s"}
            </div>
          </>
        ) : (
          <span className={cn("text-xs", QUIET)}>{r.wastedPartial ? "partial data" : "—"}</span>
        )}
      </td>
    </tr>
  );
}

function HealthTable({ rows }: { rows: AccountHealthRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className={THEAD}>
          <tr>
            <th className={TH}>Account · what to look at</th>
            <Head right tip={DEFINITIONS.spend} note="month to date">Spend</Head>
            <Head right tip={DEFINITIONS.pacing} note="avg/day vs budget">Pacing</Head>
            <Head right tip={DEFINITIONS.budgetLost} note="Search only">Lost to budget</Head>
            <Head right tip={DEFINITIONS.rankLost} note="Search only">Lost to rank</Head>
            <Head right tip={DEFINITIONS.score}>Opt. score</Head>
            <Head right tip={DEFINITIONS.conversions} note="month to date">Conversions</Head>
            <Head right tip={DEFINITIONS.signed} note="month to date">Signed</Head>
            <Head right tip={DEFINITIONS.wasted} note={`Search · ${T.wastedWindowDays} days`}>Wasted spend</Head>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <Row key={r.id} r={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TIER_LABEL: Record<Tier, { title: string; blurb: string }> = {
  act: { title: "Act now", blurb: "Something here is costing real money or corrupting the account's own numbers." },
  watch: { title: "Watch", blurb: "Worth a look this week; not an emergency." },
  ok: { title: "On track", blurb: "Nothing outside what is normal for this portfolio." },
  nodata: { title: "No current data", blurb: "Not judged — the account-health sync has nothing current for these." },
};

function TierSection({ tier, rows, collapsed = false }: { tier: Tier; rows: AccountHealthRow[]; collapsed?: boolean }) {
  if (rows.length === 0) return null;
  const { title, blurb } = TIER_LABEL[tier];
  const badge = tier === "act" ? "red" : tier === "watch" ? "amber" : "outline";
  const heading = (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className={badgeClasses(badge, "sm", "rounded-full")}>
        {title} · {rows.length}
      </span>
      <span className="text-xs text-muted-foreground">{blurb}</span>
    </span>
  );
  if (collapsed) {
    return (
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
          {heading}
        </summary>
        <div className="mt-3">
          <HealthTable rows={rows} />
        </div>
      </details>
    );
  }
  return (
    <section className="space-y-3">
      {heading}
      <HealthTable rows={rows} />
    </section>
  );
}

// Account-health overview for Google Ads (PPC): a triage of every active
// account, so a short scan says which few to open and why. Stored data only
// (ppc_account_health_daily + the PPC syncs' tables); the triage rules live
// in src/lib/ads-account-health.ts.
export default async function AdsDashboardOverviewPage() {
  const o = await getAccountHealthOverview(yesterdayIsoEastern());
  const by = (tier: Tier) => o.rows.filter((r) => r.triage.tier === tier);
  const act = by("act");
  const watch = by("watch");
  const ok = by("ok");
  const nodata = by("nodata");
  const spend = o.rows.reduce((n, r) => n + r.mtdSpend, 0);
  const signed = o.rows.reduce((n, r) => n + (r.signedMtd ?? 0), 0);
  const first = act.slice(0, 3);

  return (
    <div className="space-y-6">
      <header>
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Google Ads · PPC
        </div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Ads Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Which accounts to open first, and why. Month to date · {fmtDay(o.monthStart)} –{" "}
          {fmtDay(o.through)}.
        </p>
        <p className="mt-3 inline-flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-xs">
          <span className={badgeClasses("blue", "sm", "rounded-full")}>Google Ads (PPC) only</span>
          <span className="text-muted-foreground">
            Search and Performance Max accounts. Local Services Ads are reported separately under LSA
            and are not included in any figure here.
          </span>
        </p>
      </header>

      {o.rows.length > 0 && nodata.length === o.rows.length && (
        <Banner tone="info" title="No account-health data yet">
          The daily account-health sync has not produced a current snapshot. It runs each morning
          after the PPC syncs.
        </Banner>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile
          label="Act now"
          value={`${act.length} of ${o.rows.length}`}
          sublabel="Accounts with an emergency"
          icon={<Siren className="h-4 w-4" />}
          tone={act.length > 0 ? "red" : "default"}
        />
        <StatTile
          label="Watch"
          value={fmtInt(watch.length)}
          sublabel="Worth a look this week"
          icon={<Eye className="h-4 w-4" />}
          tone={watch.length > 0 ? "amber" : "default"}
        />
        <StatTile
          label="Spend"
          value={fmtUsd(spend)}
          sublabel="Month to date, all campaign types"
          icon={<CircleDollarSign className="h-4 w-4" />}
          tone="brand"
        />
        <StatTile
          label="Signed cases"
          value={fmtInt(signed)}
          sublabel="Month to date · CallRail, GMB excluded"
          icon={<FileSignature className="h-4 w-4" />}
        />
      </div>

      {first.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Open these first</h2>
          <div className="grid gap-3 lg:grid-cols-3">
            {first.map((r, i) => (
              <Link
                key={r.id}
                href={issueHref(r.id, r.triage.primary)}
                className="group rounded-lg border border-red-500/30 bg-red-500/[0.04] p-4 transition-colors hover:bg-red-500/[0.08]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold">
                    <span className="mr-1.5 text-muted-foreground">{i + 1}.</span>
                    {r.name}
                  </div>
                  <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
                <p className="mt-2 text-sm">{r.triage.primary?.text}</p>
                {r.triage.secondary && (
                  <p className="mt-2 text-xs text-muted-foreground">Also: {r.triage.secondary.text}</p>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      {o.rows.length === 0 ? (
        <Banner tone="info" title="No accounts">
          No active PPC client has a linked Google Ads account.
        </Banner>
      ) : (
        <div className="space-y-6">
          <TierSection tier="act" rows={act} />
          <TierSection tier="watch" rows={watch} />
          <TierSection tier="ok" rows={ok} collapsed />
          <TierSection tier="nodata" rows={nodata} collapsed />
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        An account is raised only for something worth acting on: conversions that are mostly junk,
        spend running well past the current budget, a long and expensive gap since the last signed
        case, or unusually high spend on search terms that never convert. Each account shows its
        most important issue and at most one more. Hover the ⓘ beside a column for its exact
        definition.
      </p>
    </div>
  );
}
