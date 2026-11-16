import Link from "next/link";
import type { Metadata } from "next";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { fmtConv, fmtDay, fmtInt } from "@/components/ads-dashboard-ui";
import { TRIAGE as T, type IssueKind, type Tier } from "@/lib/ads-account-health";
import { getAccountHealthOverview, type AccountHealthRow } from "@/lib/queries-ads-health";
import { yesterdayIsoEastern } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Ads Dashboard" };

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

const TIER_TEXT: Record<Tier, string> = {
  act: "text-red-700 dark:text-red-400",
  watch: "text-amber-700 dark:text-amber-400",
  ok: "text-foreground",
  nodata: "text-muted-foreground",
};
const TIER_DOT: Record<Tier, string> = {
  act: "bg-red-500",
  watch: "bg-amber-500",
  ok: "bg-transparent",
  nodata: "bg-transparent",
};

// One coloured cell per row at most: the figure behind the primary issue.
function cell(r: AccountHealthRow, ...kinds: IssueKind[]): string {
  const p = r.triage.primary;
  return p && kinds.includes(p.kind) ? cn("font-semibold", TIER_TEXT[p.tier]) : "";
}

const DEFINITIONS = {
  spend: "Month-to-date cost across every campaign type in the Google Ads account, Performance Max included. Local Services Ads are not in this figure.",
  pacing: `Average daily spend as a share of the current daily budget, over the most recent days recorded at that same budget (up to ${T.pacingWindowDays}). The daily budget is the sum of the daily budgets enabled campaigns draw on, a shared budget counted once. After a budget edit only the days since are averaged, and nothing is shown until there are ${T.pacingMinDays}.`,
  budgetLost: "Search impression share lost to budget: the share of Search auctions the account was eligible for but did not show in because budget ran out. Google's account-level figure, month to date. Search campaigns only.",
  rankLost: "Search impression share lost to rank: the share of eligible Search auctions lost because Ad Rank (bid × quality) was too low. Google's account-level figure, month to date. Search campaigns only.",
  score: "Google's account-level optimization score. Google derives it from its own open recommendations, each weighted by the impact it estimates; applying or dismissing a recommendation raises it. It reflects outstanding suggestions, not performance.",
  conversions: "Google's “Conversions” month to date, all campaign types: whatever the account is set up to count.",
  nonLead: "Share of those conversions that came from actions we class as non-lead. This is our classification, not Google's: an action whose category or name describes a tap, visit or engagement rather than a lead — phone-number or contact-link taps (click-to-call), page views, engagements, directions requests, outbound clicks, store visits, downloads. Counted from what each action actually recorded, whatever its Primary flag.",
  signed: "Signed cases from CallRail (calls and texts tagged Signed), month to date, every channel except GMB. Context only: it never decides where an account ranks.",
  wasted: `Search spend over the last ${T.wastedWindowDays} days on search terms that each cost at least the account's own cost per conversion and produced none. Search campaigns only. Not shown while most conversions are non-lead actions, or until the search-terms sync covers the whole ${T.wastedWindowDays} days.`,
} as const;

const TH_CLASS = "px-3 py-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

function Head({ children, tip }: { children: string; tip: string }) {
  return (
    <th className={cn(TH_CLASS, "whitespace-nowrap text-right align-bottom")}>
      <InfoTooltip label={children} aria-label={`Definition: ${children}`}>
        {tip}
      </InfoTooltip>
    </th>
  );
}

const NUM = "px-3 py-3 text-right tabular-nums";
const DASH = <span className="text-muted-foreground/60">—</span>;

function Row({ r, first }: { r: AccountHealthRow; first: boolean }) {
  const t = r.triage;
  const has = r.snapshotDate !== null && t.tier !== "nodata";
  const p = r.pacing;
  // Everything beyond the one line lives in hover text, not on the row.
  const more = [t.primary?.text, t.secondary && `Also: ${t.secondary.text}`, t.opportunity, t.note]
    .filter(Boolean)
    .join("\n");
  const wastedShown =
    r.wasted !== null && r.wasted.dollars > 0 && !(t.primary?.kind === "junk" && t.primary.tier === "act");
  return (
    <tr className={cn("group hover:bg-muted/40", first && "border-t-2 border-t-border")}>
      <td className="py-3 pl-3 pr-4">
        <div className="flex items-baseline gap-2.5">
          <span className={cn("h-2 w-2 shrink-0 translate-y-[-1px] rounded-full", TIER_DOT[t.tier])} />
          <div className="min-w-0">
            <Link
              href={`/ads/${r.id}/${t.primary?.kind === "wasted" ? "search-terms" : "conversions"}`}
              className={cn("font-medium group-hover:underline", t.tier === "nodata" && "text-muted-foreground")}
            >
              {r.name}
            </Link>
            {t.primary ? (
              <div className="truncate text-xs text-muted-foreground" title={more}>
                {t.primary.short}
              </div>
            ) : t.tier === "nodata" ? (
              <div className="text-xs text-muted-foreground">No current data</div>
            ) : null}
          </div>
        </div>
      </td>
      <td className={NUM}>{has ? usd0(r.mtdSpend) : DASH}</td>
      <td
        className={cn(NUM, cell(r, "pacing_over", "pacing_under"))}
        title={
          p?.judged
            ? `${usd0(p.avgDailySpend)}/day against ${usd0(p.dailyBudget)}/day, last ${p.days} days`
            : p?.reason === "too_few_days"
              ? `${p.days} of ${T.pacingMinDays} days recorded at ${usd0(r.dailyBudget)}/day`
              : p
                ? "No enabled campaign has a daily budget"
                : undefined
        }
      >
        {has && p?.judged ? pct(p.ratio) : DASH}
      </td>
      <td className={NUM}>{has && r.budgetLost !== null ? fmtLost(r.budgetLost) : DASH}</td>
      <td className={NUM}>{has && r.rankLost !== null ? fmtLost(r.rankLost) : DASH}</td>
      <td className={cn(NUM, cell(r, "optimization_score"))}>
        {has && r.optimizationScore !== null ? pct(r.optimizationScore) : DASH}
      </td>
      <td className={NUM}>{has && r.conversions !== null ? fmtConv(r.conversions) : DASH}</td>
      <td className={cn(NUM, cell(r, "junk"))}>
        {has && r.junkShare !== null && r.junkShare > 0 ? pct(r.junkShare) : DASH}
      </td>
      <td className={NUM} title={t.signedContext ?? undefined}>
        {r.signedMtd === null ? DASH : fmtInt(r.signedMtd)}
      </td>
      <td
        className={cn(NUM, "pr-4", cell(r, "wasted"))}
        title={wastedShown && r.wasted ? `${pct(r.wasted.share)} of Search spend, ${r.wasted.terms} terms` : undefined}
      >
        {wastedShown && r.wasted ? usd0(r.wasted.dollars) : DASH}
      </td>
    </tr>
  );
}

// Account-health overview for Google Ads (PPC): every active account in one
// table, worst first. Stored data only; the triage rules live in
// src/lib/ads-account-health.ts and this file only presents them.
export default async function AdsDashboardOverviewPage() {
  const o = await getAccountHealthOverview(yesterdayIsoEastern());
  const spend = o.rows.reduce((sum, r) => sum + r.mtdSpend, 0);
  const signed = o.rows.reduce((sum, r) => sum + (r.signedMtd ?? 0), 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 border-b pb-5">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Ads Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Google Ads PPC, LSA not included · {fmtDay(o.monthStart)} – {fmtDay(o.through)}
          </p>
        </div>
        <dl className="flex gap-10 text-right">
          <div>
            <dt className="text-xs text-muted-foreground">Spend</dt>
            <dd className="text-xl font-semibold tabular-nums tracking-tight">{usd0(spend)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Signed cases</dt>
            <dd className="text-xl font-semibold tabular-nums tracking-tight">{fmtInt(signed)}</dd>
          </div>
        </dl>
      </header>

      {o.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active PPC client has a linked Google Ads account.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className={cn(TH_CLASS, "pl-3 text-left align-bottom")}>Account</th>
                <Head tip={DEFINITIONS.spend}>Spend</Head>
                <Head tip={DEFINITIONS.pacing}>Pacing</Head>
                <Head tip={DEFINITIONS.budgetLost}>Lost to budget</Head>
                <Head tip={DEFINITIONS.rankLost}>Lost to rank</Head>
                <Head tip={DEFINITIONS.score}>Opt. score</Head>
                <Head tip={DEFINITIONS.conversions}>Conv.</Head>
                <Head tip={DEFINITIONS.nonLead}>Non-lead</Head>
                <Head tip={DEFINITIONS.signed}>Signed</Head>
                <Head tip={DEFINITIONS.wasted}>Wasted</Head>
              </tr>
            </thead>
            <tbody className="divide-y">
              {o.rows.map((r, i) => (
                <Row key={r.id} r={r} first={i > 0 && o.rows[i - 1].triage.tier !== r.triage.tier} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
