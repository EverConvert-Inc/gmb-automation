import Link from "next/link";
import type { Metadata } from "next";
import { Activity, Ban, CircleDollarSign, FileSignature, TriangleAlert } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { SectionCard } from "@/components/ui/section-card";
import { StatTile } from "@/components/ui/stat-tile";
import { badgeClasses } from "@/components/ui/badge";
import { fmtConv, fmtDay, fmtInt, fmtUsd, TD, TDR, TH, THEAD, THR } from "@/components/ads-dashboard-ui";
import { HEALTH_THRESHOLDS as T } from "@/lib/ads-account-health";
import { getAccountHealthOverview, type AccountHealthRow } from "@/lib/queries-ads-health";
import { yesterdayIsoEastern } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Ads Dashboard" };

const FLAGGED = "font-semibold text-amber-700 dark:text-amber-400";
const QUIET = "text-muted-foreground";

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

// Lost impression share is bounded by Google at both ends: under 10% comes
// back as 0.0999 and over 90% as 0.9001.
function fmtLost(v: number | null): string {
  if (v === null) return "—";
  if (v < 0.1) return "<10%";
  if (v > 0.9) return ">90%";
  return pct(v);
}

// Spend against budget to date as a bar. The track is 150% wide with a tick
// at 100%, so over- and under-spending read at a glance.
function PacingCell({ r }: { r: AccountHealthRow }) {
  if (r.snapshotDate === null) return <span className={QUIET}>—</span>;
  const off = r.pacingRatio !== null && (r.pacingRatio > T.pacingHigh || r.pacingRatio < T.pacingLow);
  const width = r.pacingRatio === null ? 0 : Math.min(r.pacingRatio / 1.5, 1) * 100;
  return (
    <div className="min-w-[9rem]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="tabular-nums">{fmtUsd(r.mtdSpend)}</span>
        <span className={cn("text-xs tabular-nums", off ? FLAGGED : QUIET)}>
          {r.pacingRatio === null ? "no budget" : pct(r.pacingRatio)}
        </span>
      </div>
      <div className="relative mt-1 h-1.5 rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", off ? "bg-amber-500" : "bg-brand")}
          style={{ width: `${width}%` }}
        />
        <div className="absolute inset-y-[-2px] left-2/3 w-px bg-foreground/40" />
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">
        of {fmtUsd(r.expectedSpend)} expected · {fmtUsd(r.dailyBudget)}/day
        {r.sharedBudgetCount > 0 ? " · shared budget" : ""}
      </div>
    </div>
  );
}

function Row({ r }: { r: AccountHealthRow }) {
  const has = (key: string) => r.flags.some((f) => f.key === key);
  return (
    <tr className="align-top">
      <td className={TD}>
        <Link href={`/ads/${r.id}/conversions`} className="font-medium hover:underline">
          {r.name}
        </Link>
        {r.flags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {r.flags.map((f) => (
              <span
                key={f.key}
                className={badgeClasses(f.key === "data" ? "red" : "amber", "sm", "rounded-full")}
                title={f.key === "data" ? (r.lastSyncFailed ?? undefined) : undefined}
              >
                {f.label}
              </span>
            ))}
          </div>
        )}
      </td>
      <td className={TD}>
        <PacingCell r={r} />
      </td>
      <td className={cn(TDR, has("budget_lost") ? FLAGGED : QUIET)}>{fmtLost(r.budgetLost)}</td>
      <td className={cn(TDR, has("rank_lost") ? FLAGGED : QUIET)}>{fmtLost(r.rankLost)}</td>
      <td className={cn(TDR, has("optimization_score") ? FLAGGED : QUIET)}>
        {r.optimizationScore === null ? "—" : pct(r.optimizationScore)}
      </td>
      <td className={TDR}>
        <div>{r.conversions === null ? "—" : fmtConv(r.conversions)}</div>
        <div className={cn("text-[10px]", has("junk") ? FLAGGED : QUIET)}>
          {r.junkShare === null ? "" : `${pct(r.junkShare)} junk`}
        </div>
      </td>
      <td className={TDR}>
        <div className={has("no_signed") ? FLAGGED : undefined}>
          {r.signedCases === null ? "—" : fmtInt(r.signedCases)}
        </div>
        <div className={cn("text-[10px]", QUIET)}>
          {r.signedCases === null
            ? "no CallRail"
            : r.costPerSigned === null
              ? ""
              : `${fmtUsd(r.costPerSigned)} each`}
        </div>
      </td>
      <td className={TDR}>
        {r.wastedShare === null ? (
          <span className={cn("text-xs", QUIET)}>{r.searchSyncedDays === 0 ? "—" : "partial data"}</span>
        ) : (
          <>
            <div className={has("wasted") ? FLAGGED : QUIET}>{pct(r.wastedShare)}</div>
            <div className={cn("text-[10px]", QUIET)}>{fmtUsd(r.wastedSpend)}</div>
          </>
        )}
      </td>
      <td className={cn(TD, "text-xs", QUIET)}>
        {r.snapshotDate === null ? "Never" : fmtDay(r.snapshotDate)}
        {r.pullErrors && (
          <div className="text-[10px] text-amber-700 dark:text-amber-400" title={r.pullErrors}>
            partly failed
          </div>
        )}
      </td>
    </tr>
  );
}

// Account-health overview: every active PPC client on one screen, month to
// date through yesterday, accounts needing attention first. Stored data
// only (ppc_account_health_daily + the PPC syncs' tables); the per-client
// pages behind each name hold the detail.
export default async function AdsDashboardOverviewPage() {
  const o = await getAccountHealthOverview(yesterdayIsoEastern());
  const flagged = o.rows.filter((r) => r.flags.length > 0).length;
  const noSnapshot = o.rows.filter((r) => r.snapshotDate === null).length;
  const spend = o.rows.reduce((n, r) => n + r.mtdSpend, 0);
  const signed = o.rows.reduce((n, r) => n + (r.signedCases ?? 0), 0);
  const wasted = o.rows.reduce((n, r) => n + (r.wastedShare === null ? 0 : r.wastedSpend), 0);
  const period = `Month to date · ${fmtDay(o.monthStart)} – ${fmtDay(o.through)}`;

  return (
    <div className="space-y-6">
      <header>
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Google Ads
        </div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Ads Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every active PPC account, month to date. Accounts that need attention are listed first;
          click a client for its conversion audit, search terms and keywords.
        </p>
      </header>

      {o.rows.length > 0 && noSnapshot === o.rows.length && (
        <Banner tone="info" title="No account-health data yet">
          The daily account-health sync has not run. It runs each morning after the PPC syncs.
        </Banner>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile
          label="Need attention"
          value={`${flagged} of ${o.rows.length}`}
          sublabel="Accounts with at least one flag"
          icon={<TriangleAlert className="h-4 w-4" />}
          tone={flagged > 0 ? "amber" : "default"}
        />
        <StatTile
          label="Spend"
          value={fmtUsd(spend)}
          sublabel="All campaign types"
          icon={<CircleDollarSign className="h-4 w-4" />}
          tone="brand"
        />
        <StatTile
          label="Signed cases"
          value={fmtInt(signed)}
          sublabel="CallRail, GMB excluded"
          icon={<FileSignature className="h-4 w-4" />}
        />
        <StatTile
          label="Wasted Search spend"
          value={fmtUsd(wasted)}
          sublabel="Search terms with no conversion"
          icon={<Ban className="h-4 w-4" />}
        />
      </div>

      <SectionCard icon={<Activity className="h-4 w-4" />} title="Account health" eyebrow={period}>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className={THEAD}>
              <tr>
                <th className={TH}>Client</th>
                <th className={TH}>Spend vs budget</th>
                <th className={THR} title="Search impression share lost to budget, account level">
                  Lost to budget
                  <div className="text-[9px] font-normal normal-case tracking-normal">Search only</div>
                </th>
                <th className={THR} title="Search impression share lost to rank, account level">
                  Lost to rank
                  <div className="text-[9px] font-normal normal-case tracking-normal">Search only</div>
                </th>
                <th className={THR}>Opt. score</th>
                <th className={THR}>Conversions</th>
                <th className={THR}>Signed</th>
                <th className={THR} title="Share of Search spend on search terms with no conversion">
                  Wasted spend
                  <div className="text-[9px] font-normal normal-case tracking-normal">Search only</div>
                </th>
                <th className={TH}>Data through</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {o.rows.map((r) => (
                <Row key={r.id} r={r} />
              ))}
              {o.rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                    No active PPC client has a linked Google Ads account.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-3 space-y-1 text-xs text-muted-foreground">
          <p>
            <strong className="text-foreground">Spend vs budget</strong> compares month-to-date spend
            with today’s daily budgets × {o.daysElapsed} days (the tick marks 100%; a shared budget is
            counted once). Spend, budget, conversions and signed cases cover every campaign type,
            Performance Max included.
          </p>
          <p>
            Flagged when: spend is under {pct(T.pacingLow)} or over {pct(T.pacingHigh)} of expected ·
            lost to budget ≥ {pct(T.budgetLost)} · lost to rank ≥ {pct(T.rankLost)} · optimization
            score under {pct(T.optimizationScore)} · junk conversions ≥ {pct(T.junkShare)} · no signed
            case on {fmtUsd(T.noSignedMinSpend)}+ of spend · wasted spend ≥ {pct(T.wastedShare)} of
            Search spend.
          </p>
          <p>
            Wasted spend needs the search-terms sync to cover the whole period; until it does the
            cell reads “partial data” and is not flagged.
          </p>
        </div>
      </SectionCard>
    </div>
  );
}
