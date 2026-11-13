import { NextResponse } from "next/server";
import { and, desc, eq, gte, ilike, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { oauthCredentials, ppcAdsDaily, ppcClients } from "@/lib/db/schema";
import { decryptString } from "@/lib/crypto";
import { daysAgoIsoEastern, yesterdayIsoEastern } from "@/lib/date-utils";
import { enums } from "google-ads-api";
import { getCustomer } from "@/lib/google-ads";

export const runtime = "nodejs";
export const maxDuration = 300;

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(value, (_k, v) => {
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "object" && v !== null) {
      if (seen.has(v)) return "[Circular]";
      seen.add(v);
    }
    return v;
  });
}

// google-ads-api throws gRPC-style objects, not Error instances — same
// handling as the other diagnostics.
function describeError(err: unknown): unknown {
  if (err instanceof Error) {
    const extra: Record<string, unknown> = { message: err.message };
    for (const k of Object.getOwnPropertyNames(err)) {
      if (k === "stack" || k === "message") continue;
      extra[k] = (err as unknown as Record<string, unknown>)[k];
    }
    try {
      return JSON.parse(safeStringify(extra));
    } catch {
      return { message: err.message };
    }
  }
  try {
    return JSON.parse(safeStringify(err));
  } catch {
    return { raw: String(err) };
  }
}

type Row = Record<string, Record<string, unknown> | undefined>;

function enumName(name: string, raw: unknown): string {
  if (typeof raw !== "number") return String(raw ?? "");
  const map = (enums as unknown as Record<string, Record<number, string> | undefined>)[name];
  return map?.[raw] ?? String(raw);
}

function totals(rows: Row[]) {
  let clicks = 0;
  let impressions = 0;
  let costMicros = 0;
  let conversions = 0;
  let conversionsValue = 0;
  for (const r of rows) {
    const m = r.metrics ?? {};
    clicks += Number(m.clicks ?? 0);
    impressions += Number(m.impressions ?? 0);
    costMicros += Number(m.cost_micros ?? 0);
    conversions += Number(m.conversions ?? 0);
    conversionsValue += Number(m.conversions_value ?? 0);
  }
  return {
    rows: rows.length,
    clicks,
    impressions,
    cost: Math.round(costMicros / 10_000) / 100,
    conversions: Math.round(conversions * 100) / 100,
    conversionsValue: Math.round(conversionsValue * 100) / 100,
  };
}

// Temporary read-only diagnostic for the Ads Dashboard (search terms +
// keywords + conversion-action audit). Verifies, against ONE real PPC
// client per call, the assumptions ppc-search-terms-sync.ts and the report
// pages are built on:
//   1. keyword_view: daily row count for the window, and that the selected
//      fields come back populated
//   2. search_term_view: daily row counts for every term vs clicks > 0 vs
//      conversions-only — i.e. how much the "clicks or conversions" storage
//      rule actually saves — plus the longest search term seen
//   3. whether adding the keyword segments changes search-term totals
//      (if it drops rows, the sync's query is losing data)
//   4. the hidden-terms gap: search-term totals vs keyword totals vs
//      Search-campaign totals for the same window
//   5. impression-share fields on keyword_view over a date range (no
//      segments.date) — how many keywords carry a value at all
//   6. every conversion action with primary_for_goal /
//      include_in_conversions_metric, and what each contributed to
//      metrics.conversions vs metrics.all_conversions
//   7. each campaign's goal config level (account default vs its own goals)
//
// Each query runs in its own try/catch so one rejected field can't hide the
// rest. Strictly read-only — nothing is written to Google or to the DB.
// Not registered in vercel.json. Delete once the numbers are reported.
//
// Usage:
//   /api/cron/ads-dashboard-test                      → lists Ads-linked PPC
//       clients ranked by last-30-day spend, to pick the large ones
//   /api/cron/ads-dashboard-test?customerId=<digits>[&days=30]
//   /api/cron/ads-dashboard-test?client=<name substring>[&days=30]
export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const clientName = url.searchParams.get("client");
  const customerIdParam = url.searchParams.get("customerId");
  const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? "30") || 30, 1), 90);
  const fromDate = daysAgoIsoEastern(days);
  const toDate = yesterdayIsoEastern();

  if (!clientName && !customerIdParam) {
    const ranked = await db
      .select({
        name: ppcClients.name,
        customerId: ppcClients.googleAdsCustomerId,
        isActive: ppcClients.isActive,
        costMicros: sql<string>`coalesce(sum(${ppcAdsDaily.costMicros}), 0)`,
        clicks: sql<string>`coalesce(sum(${ppcAdsDaily.clicks}), 0)`,
      })
      .from(ppcClients)
      .leftJoin(
        ppcAdsDaily,
        and(eq(ppcAdsDaily.ppcClientId, ppcClients.id), gte(ppcAdsDaily.date, fromDate)),
      )
      .where(
        and(isNotNull(ppcClients.googleAdsCustomerId), isNotNull(ppcClients.googleAdsOauthTokenId)),
      )
      .groupBy(ppcClients.id)
      .orderBy(desc(sql`coalesce(sum(${ppcAdsDaily.costMicros}), 0)`));
    return NextResponse.json({
      window: { fromDate, toDate },
      adsLinkedClients: ranked.length,
      activeAdsLinkedClients: ranked.filter((r) => r.isActive).length,
      clients: ranked.map((r) => ({
        name: r.name,
        customerId: r.customerId,
        isActive: r.isActive,
        cost: Math.round(Number(r.costMicros) / 10_000) / 100,
        clicks: Number(r.clicks),
      })),
    });
  }

  // Prefer ?customerId= — name matching is ambiguous when one client's name
  // is a substring of another's.
  const client = await db.query.ppcClients.findFirst({
    where: and(
      isNotNull(ppcClients.googleAdsCustomerId),
      isNotNull(ppcClients.googleAdsOauthTokenId),
      customerIdParam
        ? eq(ppcClients.googleAdsCustomerId, customerIdParam)
        : ilike(ppcClients.name, `%${clientName}%`),
    ),
  });
  if (!client) {
    return NextResponse.json({ error: "No Ads-linked ppc_clients row matched" }, { status: 404 });
  }
  const cred = await db.query.oauthCredentials.findFirst({
    where: eq(oauthCredentials.id, client.googleAdsOauthTokenId!),
  });
  if (!cred) {
    return NextResponse.json({ error: "oauth_credentials row not found" }, { status: 404 });
  }
  const customer = getCustomer(
    decryptString(cred.refreshTokenEncrypted),
    client.googleAdsCustomerId!,
  );
  const dateWhere = `segments.date BETWEEN '${fromDate}' AND '${toDate}'`;

  async function run<T>(fn: () => Promise<T>): Promise<T | { error: unknown }> {
    try {
      return await fn();
    } catch (err) {
      return { error: describeError(err) };
    }
  }
  const q = async (gaql: string) => (await customer.query(gaql)) as Row[];

  const [keywords, searchTerms, searchTermsNoKeyword, campaigns, impressionShare, conversionActions, conversionsByAction, goalConfig] =
    await Promise.all([
      // 1. keyword_view, exactly the sync's query.
      run(async () => {
        const rows = await q(`
          SELECT campaign.id, campaign.name, ad_group.id, ad_group.name,
                 ad_group_criterion.criterion_id, ad_group_criterion.keyword.text,
                 ad_group_criterion.keyword.match_type, ad_group_criterion.status,
                 ad_group_criterion.negative, segments.date,
                 metrics.clicks, metrics.impressions, metrics.cost_micros,
                 metrics.conversions, metrics.conversions_value
          FROM keyword_view WHERE ${dateWhere}`);
        const distinct = new Set<string>();
        const statusCounts: Record<string, number> = {};
        let missingText = 0;
        let negative = 0;
        for (const r of rows) {
          const c = r.ad_group_criterion ?? {};
          const key = `${r.ad_group?.id}/${c.criterion_id}`;
          if (!distinct.has(key)) {
            distinct.add(key);
            const s = enumName("AdGroupCriterionStatus", c.status);
            statusCounts[s] = (statusCounts[s] ?? 0) + 1;
          }
          if (!(c.keyword as Record<string, unknown> | undefined)?.text) missingText += 1;
          if (c.negative === true) negative += 1;
        }
        return {
          dailyRows: totals(rows),
          distinctKeywords: distinct.size,
          distinctKeywordsByCurrentStatus: statusCounts,
          rowsMissingKeywordText: missingText,
          negativeRows: negative,
          sampleRow: rows[0] ?? null,
        };
      }),

      // 2 + 3. search_term_view with the sync's keyword segments, unfiltered
      // (every term with an impression), bucketed here the way the sync's
      // two filtered queries would split it.
      run(async () => {
        const rows = await q(`
          SELECT campaign.id, ad_group.id, search_term_view.search_term,
                 search_term_view.status, segments.keyword.info.text,
                 segments.keyword.info.match_type, segments.search_term_match_type,
                 segments.date, metrics.clicks, metrics.impressions,
                 metrics.cost_micros, metrics.conversions, metrics.conversions_value
          FROM search_term_view WHERE ${dateWhere}`);
        const clicked = rows.filter((r) => Number(r.metrics?.clicks ?? 0) > 0);
        const convertedOnly = rows.filter(
          (r) => Number(r.metrics?.clicks ?? 0) === 0 && Number(r.metrics?.conversions ?? 0) > 0,
        );
        let maxLen = 0;
        let emptyKeyword = 0;
        const keys = new Set<string>();
        let duplicateKeys = 0;
        const distinctTerms = new Set<string>();
        for (const r of rows) {
          const term = String(r.search_term_view?.search_term ?? "");
          distinctTerms.add(term);
          maxLen = Math.max(maxLen, Buffer.byteLength(term));
          const info = ((r.segments?.keyword ?? {}) as Record<string, unknown>).info as
            | Record<string, unknown>
            | undefined;
          if (!info?.text) emptyKeyword += 1;
          const key = [r.segments?.date, r.ad_group?.id, term, info?.text, info?.match_type, r.segments?.search_term_match_type].join("|");
          if (keys.has(key)) duplicateKeys += 1;
          keys.add(key);
        }
        return {
          allTermsDailyRows: totals(rows),
          clicksGt0: totals(clicked),
          conversionsOnlyNoClick: totals(convertedOnly),
          wouldStoreRows: clicked.length + convertedOnly.length,
          distinctSearchTerms: distinctTerms.size,
          longestSearchTermBytes: maxLen,
          rowsWithEmptyKeywordSegment: emptyKeyword,
          duplicateUniqueKeys: duplicateKeys,
          sampleRow: clicked[0] ?? rows[0] ?? null,
        };
      }),

      // 3. Same view WITHOUT keyword segments — if these totals are higher
      // than the segmented ones above, the keyword segments drop rows.
      run(async () =>
        totals(
          await q(`
            SELECT search_term_view.search_term, segments.date, metrics.clicks,
                   metrics.impressions, metrics.cost_micros, metrics.conversions,
                   metrics.conversions_value
            FROM search_term_view WHERE ${dateWhere}`),
        ),
      ),

      // 4. Campaign totals by channel type, the reference for the gap.
      run(async () => {
        const rows = await q(`
          SELECT campaign.id, campaign.advertising_channel_type, segments.date,
                 metrics.clicks, metrics.impressions, metrics.cost_micros,
                 metrics.conversions, metrics.conversions_value
          FROM campaign WHERE ${dateWhere}`);
        const byType = new Map<string, Row[]>();
        for (const r of rows) {
          const t = enumName("AdvertisingChannelType", r.campaign?.advertising_channel_type);
          byType.set(t, [...(byType.get(t) ?? []), r]);
        }
        return Object.fromEntries(
          Array.from(byType.entries()).map(([t, rs]) => [
            t,
            { ...totals(rs), campaigns: new Set(rs.map((r) => String(r.campaign?.id))).size },
          ]),
        );
      }),

      // 5. Impression share over the whole range (ratios can't be summed
      // from daily rows, so the report will query this live).
      run(async () => {
        const rows = await q(`
          SELECT ad_group.id, ad_group_criterion.criterion_id,
                 ad_group_criterion.keyword.text,
                 ad_group_criterion.quality_info.quality_score,
                 metrics.impressions, metrics.search_impression_share,
                 metrics.search_rank_lost_impression_share,
                 metrics.search_budget_lost_impression_share,
                 metrics.search_top_impression_share,
                 metrics.search_absolute_top_impression_share,
                 metrics.search_exact_match_impression_share
          FROM keyword_view WHERE ${dateWhere}`);
        const present = (f: string) => rows.filter((r) => r.metrics?.[f] != null).length;
        return {
          keywordRows: rows.length,
          withSearchImpressionShare: present("search_impression_share"),
          withRankLostShare: present("search_rank_lost_impression_share"),
          withBudgetLostShare: present("search_budget_lost_impression_share"),
          withTopShare: present("search_top_impression_share"),
          withAbsoluteTopShare: present("search_absolute_top_impression_share"),
          withQualityScore: rows.filter(
            (r) =>
              (r.ad_group_criterion?.quality_info as Record<string, unknown> | undefined)
                ?.quality_score != null,
          ).length,
          sampleRows: rows
            .filter((r) => r.metrics?.search_impression_share != null)
            .slice(0, 3),
        };
      }),

      // 6a. Every conversion action on the account.
      run(async () => {
        const rows = await q(`
          SELECT conversion_action.id, conversion_action.name, conversion_action.status,
                 conversion_action.type, conversion_action.category,
                 conversion_action.origin, conversion_action.primary_for_goal,
                 conversion_action.include_in_conversions_metric,
                 conversion_action.counting_type
          FROM conversion_action`);
        return rows.map((r) => {
          const a = r.conversion_action ?? {};
          return {
            id: String(a.id ?? ""),
            name: a.name,
            status: enumName("ConversionActionStatus", a.status),
            type: enumName("ConversionActionType", a.type),
            category: enumName("ConversionActionCategory", a.category),
            origin: enumName("ConversionOrigin", a.origin),
            primaryForGoal: a.primary_for_goal ?? null,
            includeInConversionsMetric: a.include_in_conversions_metric ?? null,
            countingType: enumName("ConversionActionCountingType", a.counting_type),
          };
        });
      }),

      // 6b. What each action actually contributed in the window.
      run(async () => {
        const rows = await q(`
          SELECT segments.conversion_action, segments.conversion_action_name,
                 metrics.conversions, metrics.all_conversions
          FROM campaign WHERE ${dateWhere}`);
        const byAction = new Map<string, { name: string; conversions: number; allConversions: number }>();
        for (const r of rows) {
          const key = String(r.segments?.conversion_action ?? "");
          const prev = byAction.get(key) ?? {
            name: String(r.segments?.conversion_action_name ?? ""),
            conversions: 0,
            allConversions: 0,
          };
          prev.conversions += Number(r.metrics?.conversions ?? 0);
          prev.allConversions += Number(r.metrics?.all_conversions ?? 0);
          byAction.set(key, prev);
        }
        return Array.from(byAction.entries()).map(([resourceName, v]) => ({
          id: resourceName.split("/").pop(),
          name: v.name,
          conversions: Math.round(v.conversions * 100) / 100,
          allConversions: Math.round(v.allConversions * 100) / 100,
        }));
      }),

      // 7. Does any campaign use its own goals instead of the account's?
      run(async () => {
        const rows = await q(`
          SELECT campaign.id, campaign.name, campaign.status,
                 campaign.advertising_channel_type,
                 conversion_goal_campaign_config.goal_config_level,
                 conversion_goal_campaign_config.custom_conversion_goal
          FROM conversion_goal_campaign_config`);
        const counts: Record<string, number> = {};
        const nonDefault: unknown[] = [];
        for (const r of rows) {
          const cfg = r.conversion_goal_campaign_config ?? {};
          const level = enumName("GoalConfigLevel", cfg.goal_config_level);
          counts[level] = (counts[level] ?? 0) + 1;
          if (level !== "CUSTOMER" || cfg.custom_conversion_goal) {
            nonDefault.push({
              campaign: r.campaign?.name,
              status: enumName("CampaignStatus", r.campaign?.status),
              channel: enumName("AdvertisingChannelType", r.campaign?.advertising_channel_type),
              level,
              customGoal: cfg.custom_conversion_goal ?? null,
            });
          }
        }
        return { campaignsByGoalConfigLevel: counts, nonDefault: nonDefault.slice(0, 25) };
      }),
    ]);

  return new NextResponse(
    safeStringify({
      client: { name: client.name, customerId: client.googleAdsCustomerId },
      window: { fromDate, toDate, days },
      keywords,
      searchTerms,
      searchTermsWithoutKeywordSegments: searchTermsNoKeyword,
      campaignTotalsByChannelType: campaigns,
      impressionShare,
      conversionActions,
      conversionsByActionInWindow: conversionsByAction,
      goalConfig,
    }),
    { headers: { "content-type": "application/json" } },
  );
}
