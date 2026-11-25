import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ComboBarLine } from "@/components/charts";
import { PpcDateRangeFilter } from "@/components/ppc-date-range-filter";
import { GoogleAdsOverviewFilters } from "@/components/google-ads-overview-filters";
import { GoogleAdsCampaignTable } from "@/components/google-ads-campaign-table";
import { Change, fmtDay } from "@/components/ads-dashboard-ui";
import { getGoogleAdsOverview, getOverviewComparison } from "@/lib/queries-google-ads-overview";
import { COMPARE_MODES, resolveWindow } from "@/lib/ads-dashboard-compare";
import { firstOfMonthIsoEastern, yesterdayIsoEastern } from "@/lib/date-utils";
import { conv1, int, money0, money2, pct2 } from "@/lib/google-ads-format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Google Ads — Overview" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}

// A KPI card with its change against the comparison window. A ratio that
// can't be computed in either window (no clicks, no conversion value) shows
// a dash rather than a misleading "new".
function Kpi({
  label,
  value,
  current,
  prior,
  invert = false,
  comparable,
}: {
  label: string;
  value: string;
  current: number | null;
  prior: number | null;
  invert?: boolean;
  comparable: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        <div className="mt-1 h-5">
          {comparable && (current === null || prior === null) ? (
            <span className="text-[10px] text-muted-foreground">—</span>
          ) : (
            <Change current={current ?? 0} prior={prior ?? 0} invert={invert} comparable={comparable} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default async function GoogleAdsOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  // Dates are validated (a bad one falls back to the default) because the
  // comparison window is computed from them.
  const w = resolveWindow(
    { from: one(sp.from), to: one(sp.to), compare: one(sp.compare) },
    { from: firstOfMonthIsoEastern(), to: yesterdayIsoEastern() },
  );
  const { from, to } = w;
  const versus = COMPARE_MODES.find((m) => m.key === w.mode)?.versus ?? "";
  const account = one(sp.account) ?? "all";
  const statusRaw = one(sp.status) ?? "enabled";
  const status = (["enabled", "paused", "all"].includes(statusRaw) ? statusRaw : "enabled") as
    | "enabled"
    | "paused"
    | "all";

  const clientId = account === "all" ? null : account;
  const [data, comparison] = await Promise.all([
    getGoogleAdsOverview({ range: { from, to }, clientId, status }),
    getOverviewComparison({ range: w.prior, clientId }),
  ]);

  const { kpis } = data;
  const prior = comparison.kpis;
  const comparable = comparison.covered;
  const tickEvery = Math.max(1, Math.ceil(data.daily.length / 12));
  const points = data.daily.map((p, i) => ({
    label: shortDay(p.date),
    tick: i % tickEvery === 0 || i === data.daily.length - 1 ? shortDay(p.date) : undefined,
    cost: p.cost,
    costPerConv: p.costPerConv,
  }));

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Google Ads</div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Overview</h1>
        </div>
        <div className="text-sm text-muted-foreground">
          {shortDay(from)} – {shortDay(to)}
        </div>
      </header>

      <Card>
        <CardContent className="space-y-3 p-4">
          <PpcDateRangeFilter from={from} to={to} />
          <div className="border-t pt-3">
            <GoogleAdsOverviewFilters accounts={data.accounts} account={account} status={status} compare={w.mode} />
            <p className="mt-2 text-xs text-muted-foreground">
              {fmtDay(from)} – {fmtDay(to)} {versus}: {fmtDay(w.prior.from)} – {fmtDay(w.prior.to)}
              {!comparable &&
                (comparison.earliest
                  ? ` · stored data starts ${fmtDay(comparison.earliest)}, so no change is shown`
                  : " · no stored data yet, so no change is shown")}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-7">
        <Kpi label="Total spend" value={money0(kpis.spend)} current={kpis.spend} prior={prior.spend} invert comparable={comparable} />
        <Kpi label="Impressions" value={int(kpis.impressions)} current={kpis.impressions} prior={prior.impressions} comparable={comparable} />
        <Kpi label="Clicks" value={int(kpis.clicks)} current={kpis.clicks} prior={prior.clicks} comparable={comparable} />
        <Kpi label="CTR" value={pct2(kpis.ctr)} current={kpis.ctr} prior={prior.ctr} comparable={comparable} />
        <Kpi label="Conversions" value={conv1(kpis.conversions)} current={kpis.conversions} prior={prior.conversions} comparable={comparable} />
        <Kpi
          label="Cost / conv."
          value={kpis.costPerConv === null ? "—" : money2(kpis.costPerConv)}
          current={kpis.costPerConv}
          prior={prior.costPerConv}
          invert
          comparable={comparable}
        />
        <Kpi
          label="ROAS"
          value={kpis.roas === null ? "—" : `${kpis.roas.toFixed(2)}x`}
          current={kpis.roas}
          prior={prior.roas}
          comparable={comparable}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daily Cost &amp; Cost per Conversion</CardTitle>
          <p className="text-xs text-muted-foreground">Bars show daily cost; the line shows cost per conversion over time.</p>
        </CardHeader>
        <CardContent>
          <ComboBarLine
            points={points}
            formatCost={money0}
            formatCpc={money2}
            ariaLabel="Daily cost as bars with cost per conversion as a line"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Campaigns</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <GoogleAdsCampaignTable campaigns={data.campaigns} total={data.campaignTotal} range={{ from, to }} />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Covers every campaign type, Performance Max included. ROAS and campaign type fill in from the
        next sync onward. Expanding a campaign loads its ad groups &amp; ads live — or, for Performance
        Max, its asset groups &amp; assets.{" "}
        <Link href="/ads" className="underline hover:text-foreground">
          Account health →
        </Link>
      </p>
    </div>
  );
}
