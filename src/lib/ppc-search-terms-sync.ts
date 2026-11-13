import { createHash } from "node:crypto";
import { and, eq, gte, lte, sql } from "drizzle-orm";
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
import {
  pullKeywordDaily,
  pullSearchCampaignDaily,
  pullSearchTermDaily,
  type KeywordDailyRow,
  type SearchCampaignDailyRow,
  type SearchTermDailyRow,
} from "./google-ads";

// Keyword + search-term + Search-campaign-total sync for the Ads Dashboard. Separate from
// ppc-sync.ts's campaign-level sync on purpose: its own job kind, its own
// tables, and a failure here never touches ppc_ads_daily.
//
// Every run REPLACES the whole window per client (delete + insert in one
// transaction) rather than upserting row by row. Google credits a
// conversion to the click date, so a day's numbers keep moving for weeks —
// the cron therefore re-pulls a trailing 30 days — and replacing the window
// also clears any row Google no longer reports, which an upsert would leave
// behind as stale spend.

export const SEARCH_TERMS_TRAILING_DAYS = 30;
const JOB_KIND = "google_ads_search_terms";
const INSERT_BATCH = 1000;
// Clients synced at once. Each holds a 30-day result set in memory and a
// transaction open, and the pool is 5 connections — keep this below it.
const CLIENT_CONCURRENCY = 3;

type SyncOpts = {
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
  triggeredBy?: string;
};

// See ppc-sync.ts's stringifyError for why caught errors are never cast to
// Error directly.
function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function hashSearchTerm(term: string): string {
  return createHash("md5").update(term).digest("hex");
}

// Collapses API rows that share a table's unique key into one row by
// summing metrics, so a duplicate from Google can never abort the insert on
// the unique constraint. Names take the last value seen.
export function mergeKeywordRows(rows: KeywordDailyRow[]): KeywordDailyRow[] {
  const byKey = new Map<string, KeywordDailyRow>();
  for (const r of rows) {
    if (!r.date || !r.adGroupId || !r.criterionId) continue;
    const key = [r.adGroupId, r.criterionId, r.date].join("\u0000");
    const prev = byKey.get(key);
    byKey.set(key, prev ? { ...r, ...sumMetrics(prev, r) } : r);
  }
  return Array.from(byKey.values());
}

export function mergeSearchTermRows(rows: SearchTermDailyRow[]): SearchTermDailyRow[] {
  const byKey = new Map<string, SearchTermDailyRow>();
  for (const r of rows) {
    if (!r.date || !r.adGroupId || !r.searchTerm) continue;
    const key = [
      r.date,
      r.adGroupId,
      r.searchTerm,
      r.keywordText,
      r.keywordMatchType,
      r.searchTermMatchType,
    ].join("\u0000");
    const prev = byKey.get(key);
    byKey.set(key, prev ? { ...r, ...sumMetrics(prev, r) } : r);
  }
  return Array.from(byKey.values());
}

export function mergeCampaignRows(rows: SearchCampaignDailyRow[]): SearchCampaignDailyRow[] {
  const byKey = new Map<string, SearchCampaignDailyRow>();
  for (const r of rows) {
    if (!r.date || !r.campaignId) continue;
    const key = [r.campaignId, r.date].join("\u0000");
    const prev = byKey.get(key);
    byKey.set(key, prev ? { ...r, ...sumMetrics(prev, r) } : r);
  }
  return Array.from(byKey.values());
}

type Metrics = {
  clicks: number;
  impressions: number;
  costMicros: bigint;
  conversions: number;
  conversionsValue: number;
};

function sumMetrics(a: Metrics, b: Metrics): Metrics {
  return {
    clicks: a.clicks + b.clicks,
    impressions: a.impressions + b.impressions,
    costMicros: a.costMicros + b.costMicros,
    conversions: a.conversions + b.conversions,
    conversionsValue: a.conversionsValue + b.conversionsValue,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function syncSearchTermsForClient(
  ppcClientId: string,
  opts: SyncOpts,
): Promise<{ jobId: string; keywordRows: number; searchTermRows: number; campaignRows: number }> {
  const [job] = await db
    .insert(ppcSyncJobs)
    .values({
      ppcClientId,
      kind: JOB_KIND,
      status: "running",
      startedAt: new Date(),
      triggeredBy: opts.triggeredBy ?? "manual",
    })
    .returning();
  const jobId = job.id;

  try {
    const client = await db.query.ppcClients.findFirst({
      where: eq(ppcClients.id, ppcClientId),
    });
    if (!client) throw new Error(`PPC client ${ppcClientId} not found`);
    if (!client.googleAdsOauthTokenId || !client.googleAdsCustomerId) {
      throw new Error("PPC client is not linked to Google Ads");
    }
    const cred = await db.query.oauthCredentials.findFirst({
      where: eq(oauthCredentials.id, client.googleAdsOauthTokenId),
    });
    if (!cred) throw new Error("OAuth credential row missing");
    const refreshToken = decryptString(cred.refreshTokenEncrypted);

    // Every pull must succeed before anything is deleted: the three tables
    // are subtracted from each other (the two gap rows), so they always
    // have to describe the same window as of the same run.
    const [keywordRaw, searchTermRaw, campaignRaw] = await Promise.all([
      pullKeywordDaily(refreshToken, client.googleAdsCustomerId, opts.fromDate, opts.toDate),
      pullSearchTermDaily(refreshToken, client.googleAdsCustomerId, opts.fromDate, opts.toDate),
      pullSearchCampaignDaily(refreshToken, client.googleAdsCustomerId, opts.fromDate, opts.toDate),
    ]);
    const keywordRows = mergeKeywordRows(keywordRaw);
    const searchTermRows = mergeSearchTermRows(searchTermRaw);
    const campaignRows = mergeCampaignRows(campaignRaw);

    await db.transaction(async (tx) => {
      await tx
        .delete(ppcKeywordsDaily)
        .where(
          and(
            eq(ppcKeywordsDaily.ppcClientId, ppcClientId),
            gte(ppcKeywordsDaily.date, opts.fromDate),
            lte(ppcKeywordsDaily.date, opts.toDate),
          ),
        );
      for (const batch of chunk(keywordRows, INSERT_BATCH)) {
        await tx.insert(ppcKeywordsDaily).values(
          batch.map((r) => ({
            ppcClientId,
            date: r.date,
            googleAdsCampaignId: r.campaignId,
            campaignName: r.campaignName,
            adGroupId: r.adGroupId,
            adGroupName: r.adGroupName,
            criterionId: r.criterionId,
            keywordText: r.keywordText,
            matchType: r.matchType,
            clicks: r.clicks,
            impressions: r.impressions,
            costMicros: r.costMicros,
            conversions: r.conversions.toFixed(2),
            conversionsValue: r.conversionsValue.toFixed(2),
          })),
        );
      }

      await tx
        .delete(ppcSearchTermsDaily)
        .where(
          and(
            eq(ppcSearchTermsDaily.ppcClientId, ppcClientId),
            gte(ppcSearchTermsDaily.date, opts.fromDate),
            lte(ppcSearchTermsDaily.date, opts.toDate),
          ),
        );
      for (const batch of chunk(searchTermRows, INSERT_BATCH)) {
        await tx.insert(ppcSearchTermsDaily).values(
          batch.map((r) => ({
            ppcClientId,
            date: r.date,
            googleAdsCampaignId: r.campaignId,
            campaignName: r.campaignName,
            adGroupId: r.adGroupId,
            adGroupName: r.adGroupName,
            searchTerm: r.searchTerm,
            searchTermHash: hashSearchTerm(r.searchTerm),
            keywordText: r.keywordText,
            keywordMatchType: r.keywordMatchType,
            searchTermMatchType: r.searchTermMatchType,
            clicks: r.clicks,
            impressions: r.impressions,
            costMicros: r.costMicros,
            conversions: r.conversions.toFixed(2),
            conversionsValue: r.conversionsValue.toFixed(2),
          })),
        );
      }

      await tx
        .delete(ppcSearchCampaignsDaily)
        .where(
          and(
            eq(ppcSearchCampaignsDaily.ppcClientId, ppcClientId),
            gte(ppcSearchCampaignsDaily.date, opts.fromDate),
            lte(ppcSearchCampaignsDaily.date, opts.toDate),
          ),
        );
      for (const batch of chunk(campaignRows, INSERT_BATCH)) {
        await tx.insert(ppcSearchCampaignsDaily).values(
          batch.map((r) => ({
            ppcClientId,
            date: r.date,
            googleAdsCampaignId: r.campaignId,
            campaignName: r.campaignName,
            clicks: r.clicks,
            impressions: r.impressions,
            costMicros: r.costMicros,
            conversions: r.conversions.toFixed(2),
            conversionsValue: r.conversionsValue.toFixed(2),
          })),
        );
      }
    });

    await db
      .update(ppcSyncJobs)
      .set({ status: "completed", completedAt: new Date(), errorMessage: null })
      .where(eq(ppcSyncJobs.id, jobId));
    return {
      jobId,
      keywordRows: keywordRows.length,
      searchTermRows: searchTermRows.length,
      campaignRows: campaignRows.length,
    };
  } catch (err) {
    const msg = stringifyError(err);
    // Deliberately does not write ppc_clients.lastSyncError — that field
    // belongs to the campaign/CallRail syncs and drives their status UI.
    await db
      .update(ppcSyncJobs)
      .set({ status: "failed", completedAt: new Date(), errorMessage: msg.slice(0, 2000) })
      .where(eq(ppcSyncJobs.id, jobId));
    throw err;
  }
}

// Best-effort sweep across every active, Ads-linked PPC client. Per-client
// errors are collected, never thrown.
export async function syncAllSearchTerms(opts: SyncOpts): Promise<{
  synced: number;
  errored: number;
  keywordRows: number;
  searchTermRows: number;
  errors: Array<{ ppcClientId: string; message: string }>;
}> {
  const candidates = await db.query.ppcClients.findMany({
    where: and(
      eq(ppcClients.isActive, true),
      sql`${ppcClients.googleAdsOauthTokenId} is not null`,
      sql`${ppcClients.googleAdsCustomerId} is not null`,
    ),
  });

  const result = {
    synced: 0,
    errored: 0,
    keywordRows: 0,
    searchTermRows: 0,
    errors: [] as Array<{ ppcClientId: string; message: string }>,
  };
  const queue = [...candidates];
  await Promise.all(
    Array.from({ length: Math.min(CLIENT_CONCURRENCY, queue.length) }, async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        try {
          const r = await syncSearchTermsForClient(c.id, opts);
          result.synced += 1;
          result.keywordRows += r.keywordRows;
          result.searchTermRows += r.searchTermRows;
        } catch (err) {
          result.errored += 1;
          result.errors.push({ ppcClientId: c.id, message: stringifyError(err) });
        }
      }
    }),
  );
  return result;
}
