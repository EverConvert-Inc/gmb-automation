import { and, asc, eq, gte, lte, min, sql } from "drizzle-orm";
import { db } from "./db/client";
import { ppcAdsDaily, ppcCampaigns, ppcClients } from "./db/schema";
import { eachIsoDate } from "./ads-dashboard-compare";

// Read side of the Google Ads Overview (/ads/overview): account-wide KPIs,
// a daily cost + cost-per-conversion series, and a per-campaign table — all
// from the stored ppc_ads_daily facts (every campaign type, PMax included)
// joined to the ppc_campaigns dimension. No live Google Ads calls.
//
// Totals and the daily chart deliberately cover ALL campaigns in the window:
// ppc_campaigns.status reflects the campaign's CURRENT status, so filtering
// the totals by it would silently drop real historical spend from anything
// since paused (the same trap documented for the GAQL queries). The status
// filter is applied only to the campaign TABLE, which is a current-state view.

export type GoogleAdsOverviewRange = { from: string; to: string };

export type OverviewKpis = {
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null; // 0..1
  conversions: number;
  costPerConv: number | null;
  roas: number | null; // conversion value / cost
};

export type DailyPoint = {
  date: string;
  cost: number;
  costPerConv: number | null;
};

export type CampaignRow = {
  campaignId: string; // our uuid
  googleAdsCampaignId: string;
  clientId: string; // ppc_clients.id, for the live ad-group/ad breakdown
  name: string;
  accountName: string;
  status: string | null;
  type: string | null; // advertising_channel_type enum name
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpc: number | null; // dollars
  cost: number;
  conversions: number;
  costPerConv: number | null;
};

export type GoogleAdsOverview = {
  accounts: Array<{ id: string; name: string; isActive: boolean }>;
  kpis: OverviewKpis;
  daily: DailyPoint[];
  campaigns: CampaignRow[];
  campaignTotal: number; // campaigns before the status filter
};

const n = (v: string | number | null | undefined): number => Number(v ?? 0);
const micros = (v: string | number | null | undefined): number => n(v) / 1_000_000;
const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

type TotalsRow = {
  impressions: string;
  clicks: string;
  conversions: string;
  conversionsValue: string;
  costMicros: string;
};

function kpisFrom(rows: TotalsRow[]): OverviewKpis {
  const totals = rows.reduce(
    (a, r) => ({
      spend: a.spend + micros(r.costMicros),
      impressions: a.impressions + n(r.impressions),
      clicks: a.clicks + n(r.clicks),
      conversions: a.conversions + n(r.conversions),
      conversionsValue: a.conversionsValue + n(r.conversionsValue),
    }),
    { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionsValue: 0 },
  );
  return {
    spend: totals.spend,
    impressions: totals.impressions,
    clicks: totals.clicks,
    ctr: ratio(totals.clicks, totals.impressions),
    conversions: totals.conversions,
    costPerConv: ratio(totals.spend, totals.conversions),
    // No conversion value in the window means either it isn't tracked (common
    // for lead-gen) or the rows predate the column — either way a 0.00x ROAS
    // would mislead, so show nothing until there's real value to divide.
    roas: totals.conversionsValue > 0 ? ratio(totals.conversionsValue, totals.spend) : null,
  };
}

function scopeWhere(range: GoogleAdsOverviewRange, clientId: string | null) {
  const dateWhere = and(gte(ppcAdsDaily.date, range.from), lte(ppcAdsDaily.date, range.to));
  return clientId ? and(dateWhere, eq(ppcAdsDaily.ppcClientId, clientId)) : dateWhere;
}

// KPI totals for the comparison window, plus whether that window is covered
// by stored data at all. ppc_ads_daily has no per-day coverage marker (Google
// returns no row for a zero-spend day), but the PPC sync runs daily from the
// first day it ever pulled, so a window starting before the earliest stored
// date for this scope is the one case we know is incomplete.
export async function getOverviewComparison(opts: {
  range: GoogleAdsOverviewRange;
  clientId?: string | null;
}): Promise<{ kpis: OverviewKpis; covered: boolean; earliest: string | null }> {
  const clientId = opts.clientId ?? null;
  const [rows, [first]] = await Promise.all([
    db
      .select({
        impressions: sql<string>`sum(${ppcAdsDaily.impressions})`,
        clicks: sql<string>`sum(${ppcAdsDaily.clicks})`,
        conversions: sql<string>`sum(${ppcAdsDaily.conversions})`,
        conversionsValue: sql<string>`sum(${ppcAdsDaily.conversionsValue})`,
        costMicros: sql<string>`sum(${ppcAdsDaily.costMicros})`,
      })
      .from(ppcAdsDaily)
      .where(scopeWhere(opts.range, clientId)),
    db
      .select({ earliest: min(ppcAdsDaily.date) })
      .from(ppcAdsDaily)
      .where(clientId ? eq(ppcAdsDaily.ppcClientId, clientId) : undefined),
  ]);
  const earliest = first?.earliest ?? null;
  return {
    kpis: kpisFrom(rows),
    covered: earliest !== null && earliest <= opts.range.from,
    earliest,
  };
}

export async function getGoogleAdsOverview(opts: {
  range: GoogleAdsOverviewRange;
  clientId?: string | null;
  status?: "enabled" | "paused" | "all";
}): Promise<GoogleAdsOverview> {
  const { from, to } = opts.range;
  const clientId = opts.clientId ?? null;
  const status = opts.status ?? "enabled";

  const scope = scopeWhere({ from, to }, clientId);

  const [accounts, dailyRows, campaignRows] = await Promise.all([
    db
      .select({ id: ppcClients.id, name: ppcClients.name, isActive: ppcClients.isActive })
      .from(ppcClients)
      .orderBy(asc(ppcClients.name)),
    db
      .select({
        date: ppcAdsDaily.date,
        impressions: sql<string>`sum(${ppcAdsDaily.impressions})`,
        clicks: sql<string>`sum(${ppcAdsDaily.clicks})`,
        conversions: sql<string>`sum(${ppcAdsDaily.conversions})`,
        conversionsValue: sql<string>`sum(${ppcAdsDaily.conversionsValue})`,
        costMicros: sql<string>`sum(${ppcAdsDaily.costMicros})`,
      })
      .from(ppcAdsDaily)
      .where(scope)
      .groupBy(ppcAdsDaily.date)
      .orderBy(asc(ppcAdsDaily.date)),
    db
      .select({
        campaignId: ppcCampaigns.id,
        googleAdsCampaignId: ppcCampaigns.googleAdsCampaignId,
        clientId: ppcClients.id,
        name: ppcCampaigns.name,
        status: ppcCampaigns.status,
        type: ppcCampaigns.advertisingChannelType,
        accountName: ppcClients.name,
        impressions: sql<string>`sum(${ppcAdsDaily.impressions})`,
        clicks: sql<string>`sum(${ppcAdsDaily.clicks})`,
        conversions: sql<string>`sum(${ppcAdsDaily.conversions})`,
        costMicros: sql<string>`sum(${ppcAdsDaily.costMicros})`,
      })
      .from(ppcAdsDaily)
      .innerJoin(ppcCampaigns, eq(ppcAdsDaily.campaignId, ppcCampaigns.id))
      .innerJoin(ppcClients, eq(ppcAdsDaily.ppcClientId, ppcClients.id))
      .where(scope)
      .groupBy(
        ppcCampaigns.id,
        ppcCampaigns.googleAdsCampaignId,
        ppcClients.id,
        ppcCampaigns.name,
        ppcCampaigns.status,
        ppcCampaigns.advertisingChannelType,
        ppcClients.name,
      ),
  ]);

  // Google returns no row for a zero-activity day, so fill the gaps across the
  // whole range: the chart's x-axis stays calendar-accurate and its cost/conv
  // line breaks over gaps (null) instead of being drawn straight across them.
  const byDate = new Map<string, DailyPoint>();
  for (const r of dailyRows) {
    const cost = micros(r.costMicros);
    byDate.set(r.date, { date: r.date, cost, costPerConv: ratio(cost, n(r.conversions)) });
  }
  const daily: DailyPoint[] = eachIsoDate(from, to).map(
    (date) => byDate.get(date) ?? { date, cost: 0, costPerConv: null },
  );

  const kpis = kpisFrom(dailyRows);

  const allCampaigns: CampaignRow[] = campaignRows
    .map((r) => {
      const cost = micros(r.costMicros);
      const clicks = n(r.clicks);
      const impressions = n(r.impressions);
      const conversions = n(r.conversions);
      return {
        campaignId: r.campaignId,
        googleAdsCampaignId: r.googleAdsCampaignId,
        clientId: r.clientId,
        name: r.name,
        accountName: r.accountName,
        status: r.status,
        type: r.type,
        impressions,
        clicks,
        ctr: ratio(clicks, impressions),
        cpc: ratio(cost, clicks),
        cost,
        conversions,
        costPerConv: ratio(cost, conversions),
      };
    })
    .sort((a, b) => b.cost - a.cost);

  const campaigns =
    status === "all"
      ? allCampaigns
      : allCampaigns.filter((c) =>
          status === "enabled" ? c.status === "ENABLED" : c.status === "PAUSED",
        );

  return { accounts, kpis, daily, campaigns, campaignTotal: allCampaigns.length };
}
