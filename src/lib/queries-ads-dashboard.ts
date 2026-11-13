import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { enums } from "google-ads-api";
import { db } from "./db/client";
import {
  oauthCredentials,
  ppcClients,
  ppcKeywordsDaily,
  ppcSearchCampaignsDaily,
  ppcSearchTermsDaily,
  ppcSyncJobs,
} from "./db/schema";
import { decryptString } from "./crypto";
import { getCustomer } from "./google-ads";
import { auditConversionActions, type AuditActionInput } from "./ads-conversion-audit";

// Read side of the Ads Dashboard (/ads). Search terms, keywords and Search
// campaign totals come from the three ppc_*_daily tables written by
// ppc-search-terms-sync.ts. Impression share and the conversion-action
// audit are queried live from Google Ads for the exact window on screen:
// impression share is a ratio that can't be summed from daily rows, and
// the audit is about the account's CURRENT configuration.

export type Range = { from: string; to: string };

export type Totals = {
  clicks: number;
  impressions: number;
  cost: number; // dollars
  conversions: number;
};

const ZERO: Totals = { clicks: 0, impressions: 0, cost: 0, conversions: 0 };

function toTotals(r: {
  clicks: string | number | null;
  impressions: string | number | null;
  costMicros: string | number | null;
  conversions: string | number | null;
}): Totals {
  return {
    clicks: Number(r.clicks ?? 0),
    impressions: Number(r.impressions ?? 0),
    cost: Number(r.costMicros ?? 0) / 1_000_000,
    conversions: Number(r.conversions ?? 0),
  };
}

function plus(a: Totals, b: Totals): Totals {
  return {
    clicks: a.clicks + b.clicks,
    impressions: a.impressions + b.impressions,
    cost: a.cost + b.cost,
    conversions: a.conversions + b.conversions,
  };
}

function minus(a: Totals, b: Totals): Totals {
  return {
    clicks: a.clicks - b.clicks,
    impressions: a.impressions - b.impressions,
    cost: a.cost - b.cost,
    conversions: a.conversions - b.conversions,
  };
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  // google-ads-api rejects with { errors: [{ message }] } objects.
  const messages = (err as { errors?: Array<{ message?: string }> } | null)?.errors
    ?.map((e) => e.message)
    .filter(Boolean);
  if (messages && messages.length > 0) return messages.join(" · ");
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// ---------------------------------------------------------------------------
// Client list
// ---------------------------------------------------------------------------

export type AdsDashboardClient = {
  id: string;
  name: string;
  customerId: string | null;
  searchCost: number;
  searchClicks: number;
  searchConversions: number;
  lastSyncAt: Date | null;
  lastSyncFailed: string | null;
};

export async function listAdsDashboardClients(range: Range): Promise<AdsDashboardClient[]> {
  const clients = await db.query.ppcClients.findMany({
    where: and(
      eq(ppcClients.isActive, true),
      sql`${ppcClients.googleAdsOauthTokenId} is not null`,
      sql`${ppcClients.googleAdsCustomerId} is not null`,
    ),
    columns: { id: true, name: true, googleAdsCustomerId: true },
  });
  const [totals, jobs] = await Promise.all([
    db
      .select({
        ppcClientId: ppcSearchCampaignsDaily.ppcClientId,
        clicks: sql<string>`sum(${ppcSearchCampaignsDaily.clicks})`,
        impressions: sql<string>`sum(${ppcSearchCampaignsDaily.impressions})`,
        costMicros: sql<string>`sum(${ppcSearchCampaignsDaily.costMicros})`,
        conversions: sql<string>`sum(${ppcSearchCampaignsDaily.conversions})`,
      })
      .from(ppcSearchCampaignsDaily)
      .where(
        and(gte(ppcSearchCampaignsDaily.date, range.from), lte(ppcSearchCampaignsDaily.date, range.to)),
      )
      .groupBy(ppcSearchCampaignsDaily.ppcClientId),
    // Latest search-terms job per client.
    db
      .selectDistinctOn([ppcSyncJobs.ppcClientId], {
        ppcClientId: ppcSyncJobs.ppcClientId,
        status: ppcSyncJobs.status,
        completedAt: ppcSyncJobs.completedAt,
        errorMessage: ppcSyncJobs.errorMessage,
      })
      .from(ppcSyncJobs)
      .where(eq(ppcSyncJobs.kind, "google_ads_search_terms"))
      .orderBy(ppcSyncJobs.ppcClientId, desc(ppcSyncJobs.createdAt)),
  ]);
  const totalsById = new Map(totals.map((t) => [t.ppcClientId, toTotals(t)]));
  const jobById = new Map(jobs.map((j) => [j.ppcClientId, j]));
  return clients
    .map((c) => {
      const t = totalsById.get(c.id) ?? ZERO;
      const job = jobById.get(c.id);
      return {
        id: c.id,
        name: c.name,
        customerId: c.googleAdsCustomerId,
        searchCost: t.cost,
        searchClicks: t.clicks,
        searchConversions: t.conversions,
        lastSyncAt: job?.status === "completed" ? job.completedAt : null,
        lastSyncFailed: job?.status === "failed" ? (job.errorMessage ?? "failed") : null,
      };
    })
    .sort((a, b) => b.searchCost - a.searchCost || a.name.localeCompare(b.name));
}

export async function getAdsDashboardClient(id: string) {
  // A malformed id would make Postgres throw on the uuid cast.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (
    (await db.query.ppcClients.findFirst({
      where: eq(ppcClients.id, id),
      columns: {
        id: true,
        name: true,
        googleAdsCustomerId: true,
        googleAdsOauthTokenId: true,
      },
    })) ?? null
  );
}

// ---------------------------------------------------------------------------
// Stored totals
// ---------------------------------------------------------------------------

async function campaignTotals(clientId: string, r: Range): Promise<Totals> {
  const [row] = await db
    .select({
      clicks: sql<string>`sum(${ppcSearchCampaignsDaily.clicks})`,
      impressions: sql<string>`sum(${ppcSearchCampaignsDaily.impressions})`,
      costMicros: sql<string>`sum(${ppcSearchCampaignsDaily.costMicros})`,
      conversions: sql<string>`sum(${ppcSearchCampaignsDaily.conversions})`,
    })
    .from(ppcSearchCampaignsDaily)
    .where(
      and(
        eq(ppcSearchCampaignsDaily.ppcClientId, clientId),
        gte(ppcSearchCampaignsDaily.date, r.from),
        lte(ppcSearchCampaignsDaily.date, r.to),
      ),
    );
  return row ? toTotals(row) : ZERO;
}

async function keywordTotals(clientId: string, r: Range): Promise<Totals> {
  const [row] = await db
    .select({
      clicks: sql<string>`sum(${ppcKeywordsDaily.clicks})`,
      impressions: sql<string>`sum(${ppcKeywordsDaily.impressions})`,
      costMicros: sql<string>`sum(${ppcKeywordsDaily.costMicros})`,
      conversions: sql<string>`sum(${ppcKeywordsDaily.conversions})`,
    })
    .from(ppcKeywordsDaily)
    .where(
      and(
        eq(ppcKeywordsDaily.ppcClientId, clientId),
        gte(ppcKeywordsDaily.date, r.from),
        lte(ppcKeywordsDaily.date, r.to),
      ),
    );
  return row ? toTotals(row) : ZERO;
}

// Whether ANY stored Search-campaign row exists in a window — used to tell
// "nothing happened" apart from "this window was never synced".
async function hasStoredData(clientId: string, r: Range): Promise<boolean> {
  const [row] = await db
    .select({ one: sql<number>`1` })
    .from(ppcSearchCampaignsDaily)
    .where(
      and(
        eq(ppcSearchCampaignsDaily.ppcClientId, clientId),
        gte(ppcSearchCampaignsDaily.date, r.from),
        lte(ppcSearchCampaignsDaily.date, r.to),
      ),
    )
    .limit(1);
  return Boolean(row);
}

// ---------------------------------------------------------------------------
// Search terms
// ---------------------------------------------------------------------------

export type SearchTermRow = Totals & {
  searchTerm: string;
  keywords: string[];
  // True when part or all of this term's clicks had no triggering keyword.
  hasKeywordless: boolean;
  campaigns: string[];
  prior: Totals | null; // null = term absent from the comparison window
};

async function searchTermRows(clientId: string, r: Range) {
  const rows = await db
    .select({
      searchTerm: ppcSearchTermsDaily.searchTerm,
      clicks: sql<string>`sum(${ppcSearchTermsDaily.clicks})`,
      impressions: sql<string>`sum(${ppcSearchTermsDaily.impressions})`,
      costMicros: sql<string>`sum(${ppcSearchTermsDaily.costMicros})`,
      conversions: sql<string>`sum(${ppcSearchTermsDaily.conversions})`,
      keywords: sql<string[] | null>`array_agg(distinct ${ppcSearchTermsDaily.keywordText}) filter (where ${ppcSearchTermsDaily.keywordText} <> '')`,
      hasKeywordless: sql<boolean>`bool_or(${ppcSearchTermsDaily.keywordText} = '')`,
      campaigns: sql<string[]>`array_agg(distinct ${ppcSearchTermsDaily.campaignName})`,
      keywordlessClicks: sql<string>`coalesce(sum(${ppcSearchTermsDaily.clicks}) filter (where ${ppcSearchTermsDaily.keywordText} = ''), 0)`,
      keywordlessImpressions: sql<string>`coalesce(sum(${ppcSearchTermsDaily.impressions}) filter (where ${ppcSearchTermsDaily.keywordText} = ''), 0)`,
      keywordlessCostMicros: sql<string>`coalesce(sum(${ppcSearchTermsDaily.costMicros}) filter (where ${ppcSearchTermsDaily.keywordText} = ''), 0)`,
      keywordlessConversions: sql<string>`coalesce(sum(${ppcSearchTermsDaily.conversions}) filter (where ${ppcSearchTermsDaily.keywordText} = ''), 0)`,
    })
    .from(ppcSearchTermsDaily)
    .where(
      and(
        eq(ppcSearchTermsDaily.ppcClientId, clientId),
        gte(ppcSearchTermsDaily.date, r.from),
        lte(ppcSearchTermsDaily.date, r.to),
      ),
    )
    .groupBy(ppcSearchTermsDaily.searchTerm);
  return rows;
}

export type SearchTermsReconciliation = {
  // Search campaign totals — the figure everything below adds up to.
  campaign: Totals;
  // Listed search terms a keyword triggered.
  listedKeyworded: Totals;
  // Listed search terms no keyword triggered.
  listedKeywordless: Totals;
  // Gap 1: keyword traffic whose search term Google withholds (privacy
  // threshold) = keyword totals - listed keyword-triggered terms.
  privacyHidden: Totals;
  // Gap 2: Search-campaign traffic no keyword triggered and no term was
  // reported for = (campaign - keyword totals) - listed no-keyword terms.
  keywordlessUnlisted: Totals;
  // All traffic no keyword triggered = campaign - keyword totals.
  keywordlessAll: Totals;
};

export type SearchTermsReport = {
  rows: SearchTermRow[]; // every listed term, cost-descending
  reconciliation: SearchTermsReconciliation;
  priorReconciliation: SearchTermsReconciliation;
  hasData: boolean;
  priorHasData: boolean;
};

function reconcile(
  rows: Awaited<ReturnType<typeof searchTermRows>>,
  campaign: Totals,
  keyword: Totals,
): SearchTermsReconciliation {
  let listedAll = ZERO;
  let listedKeywordless = ZERO;
  for (const r of rows) {
    const all = toTotals(r);
    const kl = toTotals({
      clicks: r.keywordlessClicks,
      impressions: r.keywordlessImpressions,
      costMicros: r.keywordlessCostMicros,
      conversions: r.keywordlessConversions,
    });
    listedAll = plus(listedAll, all);
    listedKeywordless = plus(listedKeywordless, kl);
  }
  const listedKeyworded = minus(listedAll, listedKeywordless);
  const keywordlessAll = minus(campaign, keyword);
  return {
    campaign,
    listedKeyworded,
    listedKeywordless,
    privacyHidden: minus(keyword, listedKeyworded),
    keywordlessUnlisted: minus(keywordlessAll, listedKeywordless),
    keywordlessAll,
  };
}

export async function getSearchTermsReport(
  clientId: string,
  range: Range,
  prior: Range,
): Promise<SearchTermsReport> {
  const [rows, priorRows, campaign, priorCampaign, keyword, priorKeyword, hasData, priorHasData] =
    await Promise.all([
      searchTermRows(clientId, range),
      searchTermRows(clientId, prior),
      campaignTotals(clientId, range),
      campaignTotals(clientId, prior),
      keywordTotals(clientId, range),
      keywordTotals(clientId, prior),
      hasStoredData(clientId, range),
      hasStoredData(clientId, prior),
    ]);
  const priorByTerm = new Map(priorRows.map((r) => [r.searchTerm, toTotals(r)]));
  return {
    rows: rows
      .map((r) => ({
        ...toTotals(r),
        searchTerm: r.searchTerm,
        keywords: r.keywords ?? [],
        hasKeywordless: r.hasKeywordless,
        campaigns: r.campaigns,
        prior: priorByTerm.get(r.searchTerm) ?? null,
      }))
      .sort((a, b) => b.cost - a.cost || b.clicks - a.clicks),
    reconciliation: reconcile(rows, campaign, keyword),
    priorReconciliation: reconcile(priorRows, priorCampaign, priorKeyword),
    hasData,
    priorHasData,
  };
}

// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------

export type KeywordRow = Totals & {
  key: string; // adGroupId/criterionId
  keywordText: string;
  matchType: string;
  campaignName: string;
  adGroupName: string;
  prior: Totals | null;
};

async function keywordRows(clientId: string, r: Range) {
  return db
    .select({
      adGroupId: ppcKeywordsDaily.adGroupId,
      criterionId: ppcKeywordsDaily.criterionId,
      keywordText: sql<string>`max(${ppcKeywordsDaily.keywordText})`,
      matchType: sql<string>`max(${ppcKeywordsDaily.matchType})`,
      campaignName: sql<string>`max(${ppcKeywordsDaily.campaignName})`,
      adGroupName: sql<string>`max(${ppcKeywordsDaily.adGroupName})`,
      clicks: sql<string>`sum(${ppcKeywordsDaily.clicks})`,
      impressions: sql<string>`sum(${ppcKeywordsDaily.impressions})`,
      costMicros: sql<string>`sum(${ppcKeywordsDaily.costMicros})`,
      conversions: sql<string>`sum(${ppcKeywordsDaily.conversions})`,
    })
    .from(ppcKeywordsDaily)
    .where(
      and(
        eq(ppcKeywordsDaily.ppcClientId, clientId),
        gte(ppcKeywordsDaily.date, r.from),
        lte(ppcKeywordsDaily.date, r.to),
      ),
    )
    .groupBy(ppcKeywordsDaily.adGroupId, ppcKeywordsDaily.criterionId);
}

export type KeywordReport = {
  rows: KeywordRow[]; // cost-descending
  totals: Totals;
  priorTotals: Totals;
  campaign: Totals; // Search campaign totals, for the no-keyword note
  hasData: boolean;
  priorHasData: boolean;
};

export async function getKeywordReport(
  clientId: string,
  range: Range,
  prior: Range,
): Promise<KeywordReport> {
  const [rows, priorRows, totals, priorTotals, campaign, hasData, priorHasData] = await Promise.all([
    keywordRows(clientId, range),
    keywordRows(clientId, prior),
    keywordTotals(clientId, range),
    keywordTotals(clientId, prior),
    campaignTotals(clientId, range),
    hasStoredData(clientId, range),
    hasStoredData(clientId, prior),
  ]);
  const priorByKey = new Map(priorRows.map((r) => [`${r.adGroupId}/${r.criterionId}`, toTotals(r)]));
  return {
    rows: rows
      .map((r) => {
        const key = `${r.adGroupId}/${r.criterionId}`;
        return {
          ...toTotals(r),
          key,
          keywordText: r.keywordText,
          matchType: r.matchType,
          campaignName: r.campaignName,
          adGroupName: r.adGroupName,
          prior: priorByKey.get(key) ?? null,
        };
      })
      .sort((a, b) => b.cost - a.cost || b.clicks - a.clicks),
    totals,
    priorTotals,
    campaign,
    hasData,
    priorHasData,
  };
}

// ---------------------------------------------------------------------------
// Live Google Ads: impression share + conversion-action audit
// ---------------------------------------------------------------------------

type GaqlRow = Record<string, Record<string, unknown> | undefined>;

async function liveCustomer(clientId: string) {
  const client = await db.query.ppcClients.findFirst({ where: eq(ppcClients.id, clientId) });
  if (!client?.googleAdsOauthTokenId || !client.googleAdsCustomerId) {
    throw new Error("PPC client is not linked to Google Ads");
  }
  const cred = await db.query.oauthCredentials.findFirst({
    where: eq(oauthCredentials.id, client.googleAdsOauthTokenId),
  });
  if (!cred) throw new Error("OAuth credential row missing");
  return getCustomer(decryptString(cred.refreshTokenEncrypted), client.googleAdsCustomerId);
}

function enumName(name: string, raw: unknown): string {
  if (typeof raw !== "number") return String(raw ?? "");
  const map = (enums as unknown as Record<string, Record<number, string> | undefined>)[name];
  return map?.[raw] ?? String(raw);
}

// Which impression-share metrics each resource accepts. Google rejects the
// whole query if any one selected metric is incompatible with the FROM
// resource, so each report selects only its own list.
//
// Confirmed live (per-field matrix, one query per field x resource): the
// first four work on keyword_view, campaign and ad_group;
// search_budget_lost_impression_share works on campaign only (budget is a
// campaign-level concept) and is rejected elsewhere with
// PROHIBITED_METRIC_IN_SELECT_OR_WHERE_CLAUSE.
export const IMPRESSION_SHARE_FIELDS = {
  keyword_view: [
    "search_impression_share",
    "search_rank_lost_impression_share",
    "search_top_impression_share",
    "search_absolute_top_impression_share",
  ],
  campaign: [
    "search_impression_share",
    "search_rank_lost_impression_share",
    "search_top_impression_share",
    "search_absolute_top_impression_share",
    "search_budget_lost_impression_share",
  ],
} as const;

export type ImpressionShare = {
  impressionShare: number | null;
  rankLost: number | null;
  topShare: number | null;
  absoluteTopShare: number | null;
  budgetLost: number | null;
};

function readShare(metrics: Record<string, unknown> | undefined): ImpressionShare {
  const n = (k: string) => (typeof metrics?.[k] === "number" ? (metrics[k] as number) : null);
  return {
    impressionShare: n("search_impression_share"),
    rankLost: n("search_rank_lost_impression_share"),
    topShare: n("search_top_impression_share"),
    absoluteTopShare: n("search_absolute_top_impression_share"),
    budgetLost: n("search_budget_lost_impression_share"),
  };
}

export type LiveImpressionShare = {
  // Keyed adGroupId/criterionId, matching KeywordRow.key.
  byKeyword: Map<string, ImpressionShare>;
  keywordError: string | null;
  campaigns: Array<ImpressionShare & { campaignId: string; campaignName: string; impressions: number }>;
  campaignError: string | null;
};

// Impression share for the exact window, straight from Google. No
// segments.date: the API returns the range-level ratio, which daily rows
// can't be summed into. Each level fails on its own — a rejected keyword
// query still leaves the campaign rows, and the page shows the error.
export async function getLiveImpressionShare(
  clientId: string,
  range: Range,
): Promise<LiveImpressionShare> {
  const out: LiveImpressionShare = {
    byKeyword: new Map(),
    keywordError: null,
    campaigns: [],
    campaignError: null,
  };
  let customer;
  try {
    customer = await liveCustomer(clientId);
  } catch (err) {
    out.keywordError = out.campaignError = stringifyError(err);
    return out;
  }
  const dateWhere = `segments.date BETWEEN '${range.from}' AND '${range.to}'`;
  await Promise.all([
    (async () => {
      try {
        const rows = (await customer.query(`
          SELECT ad_group.id, ad_group_criterion.criterion_id,
                 ${IMPRESSION_SHARE_FIELDS.keyword_view.map((f) => `metrics.${f}`).join(", ")}
          FROM keyword_view WHERE ${dateWhere}`)) as GaqlRow[];
        for (const r of rows) {
          out.byKeyword.set(
            `${r.ad_group?.id}/${r.ad_group_criterion?.criterion_id}`,
            readShare(r.metrics),
          );
        }
      } catch (err) {
        out.keywordError = stringifyError(err);
      }
    })(),
    (async () => {
      try {
        const rows = (await customer.query(`
          SELECT campaign.id, campaign.name, metrics.impressions,
                 ${IMPRESSION_SHARE_FIELDS.campaign.map((f) => `metrics.${f}`).join(", ")}
          FROM campaign
          WHERE campaign.advertising_channel_type = 'SEARCH' AND ${dateWhere}`)) as GaqlRow[];
        out.campaigns = rows
          .map((r) => ({
            ...readShare(r.metrics),
            campaignId: String(r.campaign?.id ?? ""),
            campaignName: String(r.campaign?.name ?? ""),
            impressions: Number(r.metrics?.impressions ?? 0),
          }))
          .sort((a, b) => b.impressions - a.impressions);
      } catch (err) {
        out.campaignError = stringifyError(err);
      }
    })(),
  ]);
  return out;
}

export type ConversionAudit =
  | { ok: true; audit: ReturnType<typeof auditConversionActions>; priorTotal: number }
  | { ok: false; error: string };

// Every conversion action on the account, with what each contributed to
// metrics.conversions in the window (and the comparison window), split by
// campaign channel. Live, never stored: it reports the account's current
// setup. metrics.all_conversions is read here ONLY to show what an action
// records without counting — it is never used as a conversion figure.
export async function getConversionAudit(
  clientId: string,
  range: Range,
  prior: Range,
): Promise<ConversionAudit> {
  try {
    const customer = await liveCustomer(clientId);
    const byAction = (r: Range) =>
      customer.query(`
        SELECT campaign.advertising_channel_type, segments.conversion_action,
               segments.conversion_action_name, metrics.conversions, metrics.all_conversions
        FROM campaign
        WHERE segments.date BETWEEN '${r.from}' AND '${r.to}'`) as Promise<GaqlRow[]>;
    const [actionRows, current, previous] = await Promise.all([
      customer.query(`
        SELECT conversion_action.id, conversion_action.name, conversion_action.status,
               conversion_action.type, conversion_action.category, conversion_action.origin,
               conversion_action.primary_for_goal,
               conversion_action.include_in_conversions_metric
        FROM conversion_action`) as Promise<GaqlRow[]>,
      byAction(range),
      byAction(prior),
    ]);

    const inputs = new Map<string, AuditActionInput>();
    for (const r of actionRows) {
      const a = r.conversion_action ?? {};
      const id = String(a.id ?? "");
      inputs.set(id, {
        id,
        name: String(a.name ?? ""),
        listed: true,
        status: enumName("ConversionActionStatus", a.status),
        type: enumName("ConversionActionType", a.type),
        category: enumName("ConversionActionCategory", a.category),
        origin: enumName("ConversionOrigin", a.origin),
        primaryForGoal: typeof a.primary_for_goal === "boolean" ? a.primary_for_goal : null,
        includeInConversionsMetric:
          typeof a.include_in_conversions_metric === "boolean"
            ? a.include_in_conversions_metric
            : null,
        conversions: 0,
        allConversions: 0,
        priorConversions: 0,
        byChannel: {},
      });
    }
    const entry = (r: GaqlRow): AuditActionInput => {
      const id = String(r.segments?.conversion_action ?? "").split("/").pop() ?? "";
      let a = inputs.get(id);
      if (!a) {
        a = {
          id,
          name: String(r.segments?.conversion_action_name ?? id),
          listed: false,
          status: "",
          type: "",
          category: "",
          origin: "",
          primaryForGoal: null,
          includeInConversionsMetric: null,
          conversions: 0,
          allConversions: 0,
          priorConversions: 0,
          byChannel: {},
        };
        inputs.set(id, a);
      }
      return a;
    };
    for (const r of current) {
      const a = entry(r);
      const conv = Number(r.metrics?.conversions ?? 0);
      a.conversions += conv;
      a.allConversions += Number(r.metrics?.all_conversions ?? 0);
      if (conv > 0) {
        const channel = enumName("AdvertisingChannelType", r.campaign?.advertising_channel_type);
        a.byChannel[channel] = (a.byChannel[channel] ?? 0) + conv;
      }
    }
    let priorTotal = 0;
    for (const r of previous) {
      const conv = Number(r.metrics?.conversions ?? 0);
      if (conv === 0) continue;
      entry(r).priorConversions += conv;
      priorTotal += conv;
    }
    // Removed actions that did nothing in either window are noise.
    const relevant = Array.from(inputs.values()).filter(
      (a) => a.status === "ENABLED" || a.conversions > 0 || a.allConversions > 0 || a.priorConversions > 0,
    );
    return { ok: true, audit: auditConversionActions(relevant), priorTotal };
  } catch (err) {
    return { ok: false, error: stringifyError(err) };
  }
}
