import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ChevronDown, CircleDollarSign, Gauge, KeyRound, MousePointerClick, Target } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { SectionCard } from "@/components/ui/section-card";
import { StatTile } from "@/components/ui/stat-tile";
import {
  AdsDashboardHeader,
  Change,
  fmtConv,
  fmtCostPerConv,
  fmtDay,
  fmtInt,
  fmtShare,
  fmtUsd,
  StoredDataBanners,
  TD,
  TDR,
  TH,
  THEAD,
  THR,
} from "@/components/ads-dashboard-ui";
import {
  getAdsDashboardClient,
  getKeywordReport,
  getLiveImpressionShare,
  type ImpressionShare,
  type KeywordRow,
} from "@/lib/queries-ads-dashboard";
import { resolveWindow } from "@/lib/ads-dashboard-compare";
import { daysAgoIsoEastern, yesterdayIsoEastern } from "@/lib/date-utils";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const metadata: Metadata = { title: "Keywords" };

const TOP_N = 50;

const MATCH_LABEL: Record<string, string> = { EXACT: "Exact", PHRASE: "Phrase", BROAD: "Broad" };

function KeywordTable({
  rows,
  share,
  showShare,
}: {
  rows: KeywordRow[];
  share: Map<string, ImpressionShare>;
  showShare: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className={THEAD}>
          <tr>
            <th className={TH}>Keyword</th>
            <th className={THR}>Clicks</th>
            <th className={THR}>Cost</th>
            <th className={THR}>Cost change</th>
            <th className={THR}>Conversions</th>
            <th className={THR}>Cost / conv.</th>
            {showShare && <th className={THR}>Impr. share</th>}
            {showShare && <th className={THR}>Lost (rank)</th>}
            {showShare && <th className={THR}>Top</th>}
            {showShare && <th className={THR}>Abs. top</th>}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => {
            const s = share.get(r.key);
            return (
              <tr key={r.key}>
                <td className={TD}>
                  <div className="font-medium">
                    {r.keywordText}{" "}
                    <span className="text-[10px] font-normal text-muted-foreground">
                      {MATCH_LABEL[r.matchType] ?? r.matchType}
                    </span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {r.campaignName} › {r.adGroupName}
                  </div>
                </td>
                <td className={TDR}>{fmtInt(r.clicks)}</td>
                <td className={TDR}>{fmtUsd(r.cost)}</td>
                <td className={TDR}>
                  <Change current={r.cost} prior={r.prior?.cost ?? null} invert />
                </td>
                <td className={TDR}>{fmtConv(r.conversions)}</td>
                <td className={TDR}>{fmtCostPerConv(r.cost, r.conversions)}</td>
                {showShare && <td className={TDR}>{fmtShare(s?.impressionShare ?? null)}</td>}
                {showShare && <td className={TDR}>{fmtShare(s?.rankLost ?? null)}</td>}
                {showShare && <td className={TDR}>{fmtShare(s?.topShare ?? null)}</td>}
                {showShare && <td className={TDR}>{fmtShare(s?.absoluteTopShare ?? null)}</td>}
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={showShare ? 10 : 6} className="px-3 py-6 text-center text-muted-foreground">
                No keywords with impressions in this date range.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// Keyword report for one client. Cost/clicks/conversions come from the
// stored ppc_keywords_daily rows; impression share is fetched live for the
// exact window, since a ratio can't be summed from daily rows.
export default async function KeywordsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string; compare?: string }>;
}) {
  const { id } = await params;
  const client = await getAdsDashboardClient(id);
  if (!client) notFound();
  const w = resolveWindow(await searchParams, {
    from: daysAgoIsoEastern(30),
    to: yesterdayIsoEastern(),
  });
  const range = { from: w.from, to: w.to };
  const [report, share] = await Promise.all([
    getKeywordReport(id, range, w.prior),
    getLiveImpressionShare(id, range),
  ]);
  const t = report.totals;
  const p = report.priorTotals;
  const noKeywordCost = report.campaign.cost - t.cost;
  const eyebrow = `Search campaigns · ${fmtDay(w.from)} – ${fmtDay(w.to)}`;
  const showShare = !share.keywordError;
  const top = report.rows.slice(0, TOP_N);
  const rest = report.rows.slice(TOP_N);

  return (
    <div className="space-y-6">
      <AdsDashboardHeader client={client} tab="keywords" window={w} />
      <StoredDataBanners hasData={report.hasData} priorHasData={report.priorHasData} window={w} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile
          label="Keyword spend"
          value={fmtUsd(t.cost)}
          sublabel={<Change current={t.cost} prior={p.cost} invert />}
          icon={<CircleDollarSign className="h-4 w-4" />}
          tone="brand"
        />
        <StatTile
          label="Clicks"
          value={fmtInt(t.clicks)}
          sublabel={<Change current={t.clicks} prior={p.clicks} />}
          icon={<MousePointerClick className="h-4 w-4" />}
        />
        <StatTile
          label="Conversions"
          value={fmtConv(t.conversions)}
          sublabel={<Change current={t.conversions} prior={p.conversions} />}
          icon={<Target className="h-4 w-4" />}
        />
        <StatTile
          label="Cost / conversion"
          value={fmtCostPerConv(t.cost, t.conversions)}
          sublabel={
            t.conversions > 0 && p.conversions > 0 ? (
              <Change current={t.cost / t.conversions} prior={p.cost / p.conversions} invert />
            ) : (
              "—"
            )
          }
          icon={<Gauge className="h-4 w-4" />}
        />
      </div>

      {noKeywordCost > 0.005 && (
        <Banner tone="info" title={`${fmtUsd(noKeywordCost)} of Search spend had no keyword`}>
          Search campaigns spent {fmtUsd(report.campaign.cost)} in this window; {fmtUsd(t.cost)} of it
          is attributed to a keyword below. The rest was served without one and appears on the Search
          terms tab.
        </Banner>
      )}

      <SectionCard
        icon={<Gauge className="h-4 w-4" />}
        title="Impression share by campaign"
        eyebrow={`${eyebrow} · live from Google Ads`}
      >
        {share.campaignError ? (
          <Banner tone="error" title="Google Ads rejected the campaign impression-share query">
            {share.campaignError}
          </Banner>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className={THEAD}>
                <tr>
                  <th className={TH}>Campaign</th>
                  <th className={THR}>Impressions</th>
                  <th className={THR}>Impr. share</th>
                  <th className={THR}>Lost (rank)</th>
                  <th className={THR}>Lost (budget)</th>
                  <th className={THR}>Top</th>
                  <th className={THR}>Abs. top</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {share.campaigns.map((c) => (
                  <tr key={c.campaignId}>
                    <td className={`${TD} font-medium`}>{c.campaignName}</td>
                    <td className={TDR}>{fmtInt(c.impressions)}</td>
                    <td className={TDR}>{fmtShare(c.impressionShare)}</td>
                    <td className={TDR}>{fmtShare(c.rankLost)}</td>
                    <td className={TDR}>{fmtShare(c.budgetLost)}</td>
                    <td className={TDR}>{fmtShare(c.topShare)}</td>
                    <td className={TDR}>{fmtShare(c.absoluteTopShare)}</td>
                  </tr>
                ))}
                {share.campaigns.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                      No Search campaign served in this date range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Impression share is the share of eligible searches your ads showed on. Google reports
          anything under 10% as “&lt;10%”. Share lost to budget exists only at campaign level, so it
          is shown here and not per keyword.
        </p>
      </SectionCard>

      <SectionCard icon={<KeyRound className="h-4 w-4" />} title="Keywords by cost" eyebrow={eyebrow}>
        {share.keywordError && (
          <Banner tone="warning" title="Keyword impression share unavailable" className="mb-3">
            Google Ads rejected the query, so the impression-share columns are hidden: {share.keywordError}
          </Banner>
        )}
        <KeywordTable rows={top} share={share.byKeyword} showShare={showShare} />
        {rest.length > 0 && (
          <details className="group mt-3">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
              <span className="group-open:hidden">Show {rest.length} more</span>
              <span className="hidden group-open:inline">Hide</span>
            </summary>
            <div className="mt-3">
              <KeywordTable rows={rest} share={share.byKeyword} showShare={showShare} />
            </div>
          </details>
        )}
      </SectionCard>
    </div>
  );
}
