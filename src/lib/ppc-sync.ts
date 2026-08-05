import { and, eq, sql } from "drizzle-orm";
import { db } from "./db/client";
import {
  oauthCredentials,
  ppcAdsDaily,
  ppcCallrailTagCategories,
  ppcCampaigns,
  ppcCallrailDaily,
  ppcClients,
  ppcSyncJobs,
} from "./db/schema";
import { decryptString } from "./crypto";
import { pullDailyMetrics, pullCallViewRows, type CallViewRow } from "./google-ads";
import { pullCallsForCompany } from "./callrail";
import { yesterdayIsoEastern, daysAgoIsoEastern } from "./date-utils";

type SyncOpts = {
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
  triggeredBy?: string; // "scheduled" | "manual" | ...
};

// Re-exported under the original names so every existing caller (cron
// routes, sync-now routes) is unaffected — see date-utils.ts for why this
// is Eastern-based rather than UTC.
export const yesterdayIso = yesterdayIsoEastern;
export const daysAgoIso = daysAgoIsoEastern;

async function startJob(
  ppcClientId: string | null,
  kind: "google_ads" | "callrail",
  triggeredBy: string,
): Promise<string> {
  const [row] = await db
    .insert(ppcSyncJobs)
    .values({
      ppcClientId,
      kind,
      status: "running",
      startedAt: new Date(),
      triggeredBy,
    })
    .returning();
  return row.id;
}

// `(err as Error).message` assumes every caught rejection is a real Error
// instance — not guaranteed (a thrown string, a Google Ads API error
// array, etc. all lack a `.message`, so that cast silently evaluates to
// `undefined`). That's exactly what caused a real production crash: an
// undefined value passed as the ONLY key to a downstream
// `.set({ lastSyncError: ... })` call gets filtered out by drizzle,
// leaving zero fields to update, which throws "No values to set" —
// masking the real error entirely (and, since this function's catch
// blocks rethrow, becoming the error the caller actually sees). Route
// every caught error through this instead of casting directly.
function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

async function finishJob(
  jobId: string,
  status: "completed" | "failed",
  errorMessage: string | null,
) {
  await db
    .update(ppcSyncJobs)
    .set({
      status,
      completedAt: new Date(),
      errorMessage: errorMessage?.slice(0, 2000) ?? null,
    })
    .where(eq(ppcSyncJobs.id, jobId));
}

export async function syncGoogleAdsForClient(
  ppcClientId: string,
  opts: SyncOpts,
): Promise<{ jobId: string; daysIngested: number; campaignsIngested: number }> {
  const triggeredBy = opts.triggeredBy ?? "manual";
  const jobId = await startJob(ppcClientId, "google_ads", triggeredBy);
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

    const rows = await pullDailyMetrics(
      refreshToken,
      client.googleAdsCustomerId,
      opts.fromDate,
      opts.toDate,
    );

    // Upsert campaign dimension rows so we have stable internal ids to FK
    // ppc_ads_daily.campaign_id against, and so names stay current.
    const campaignIdMap = new Map<string, string>();
    const uniqueCampaigns = new Map<
      string,
      { campaignId: string; campaignName: string; campaignStatus: string }
    >();
    for (const r of rows) {
      if (!uniqueCampaigns.has(r.campaignId)) {
        uniqueCampaigns.set(r.campaignId, {
          campaignId: r.campaignId,
          campaignName: r.campaignName,
          campaignStatus: r.campaignStatus,
        });
      }
    }
    for (const c of uniqueCampaigns.values()) {
      const existing = await db.query.ppcCampaigns.findFirst({
        where: and(
          eq(ppcCampaigns.ppcClientId, ppcClientId),
          eq(ppcCampaigns.googleAdsCampaignId, c.campaignId),
        ),
      });
      if (existing) {
        await db
          .update(ppcCampaigns)
          .set({
            name: c.campaignName,
            status: c.campaignStatus,
            lastSeenAt: new Date(),
          })
          .where(eq(ppcCampaigns.id, existing.id));
        campaignIdMap.set(c.campaignId, existing.id);
      } else {
        const [inserted] = await db
          .insert(ppcCampaigns)
          .values({
            ppcClientId,
            googleAdsCampaignId: c.campaignId,
            name: c.campaignName,
            status: c.campaignStatus,
          })
          .returning();
        campaignIdMap.set(c.campaignId, inserted.id);
      }
    }

    // Upsert daily rows. ppc_ads_daily is unique on (campaign_id, date).
    for (const r of rows) {
      const campaignDbId = campaignIdMap.get(r.campaignId);
      if (!campaignDbId) continue;
      await db
        .insert(ppcAdsDaily)
        .values({
          ppcClientId,
          campaignId: campaignDbId,
          date: r.date,
          clicks: r.clicks,
          impressions: r.impressions,
          conversions: String(r.conversions),
          costMicros: r.costMicros,
          phoneCalls: r.phoneCalls,
        })
        .onConflictDoUpdate({
          target: [ppcAdsDaily.campaignId, ppcAdsDaily.date],
          set: {
            clicks: r.clicks,
            impressions: r.impressions,
            conversions: String(r.conversions),
            costMicros: r.costMicros,
            phoneCalls: r.phoneCalls,
            ingestedAt: new Date(),
          },
        });
    }

    await db
      .update(ppcClients)
      .set({ lastAdsSyncAt: new Date(), lastSyncError: null })
      .where(eq(ppcClients.id, ppcClientId));

    await finishJob(jobId, "completed", null);
    return {
      jobId,
      daysIngested: rows.length,
      campaignsIngested: uniqueCampaigns.size,
    };
  } catch (err) {
    const msg = stringifyError(err);
    await finishJob(jobId, "failed", msg);
    await db
      .update(ppcClients)
      .set({ lastSyncError: msg })
      .where(eq(ppcClients.id, ppcClientId));
    throw err;
  }
}

export async function syncCallrailForClient(
  ppcClientId: string,
  opts: SyncOpts,
): Promise<{ jobId: string; daysIngested: number }> {
  const triggeredBy = opts.triggeredBy ?? "manual";
  const jobId = await startJob(ppcClientId, "callrail", triggeredBy);
  try {
    const client = await db.query.ppcClients.findFirst({
      where: eq(ppcClients.id, ppcClientId),
    });
    if (!client) throw new Error(`PPC client ${ppcClientId} not found`);
    if (!client.callrailCompanyId) {
      throw new Error("PPC client is not linked to CallRail");
    }

    // rollup is stored as plain text (no DB-level enum); narrowed here
    // since the tag-category API routes are the only writers and always
    // validate it against z.enum(["real", "junk"]) before insert/update.
    const tagCategories = (
      await db.query.ppcCallrailTagCategories.findMany({
        where: eq(ppcCallrailTagCategories.ppcClientId, ppcClientId),
      })
    ).map((c) => ({ ...c, rollup: c.rollup as "real" | "junk" }));

    // GMB ad-vs-organic matching (see callrail.ts) — best-effort. A client
    // without a linked Google Ads account is the normal, expected case
    // (every GMB call just reports as organic, no callViewRows needed).
    // An actual Google Ads API failure here logs loudly but doesn't fail
    // this CallRail sync — signedCases/tagCategoryBreakdown are far more
    // load-bearing than this still-new enrichment, so a Google Ads hiccup
    // shouldn't take down the whole job.
    let callViewRows: CallViewRow[] | undefined;
    if (client.googleAdsCustomerId && client.googleAdsOauthTokenId) {
      try {
        const cred = await db.query.oauthCredentials.findFirst({
          where: eq(oauthCredentials.id, client.googleAdsOauthTokenId),
        });
        if (cred) {
          const refreshToken = decryptString(cred.refreshTokenEncrypted);
          callViewRows = await pullCallViewRows(
            refreshToken,
            client.googleAdsCustomerId,
          );
        }
      } catch (err) {
        console.error(
          `[ppc-sync] call_view pull failed for ${client.name} (${ppcClientId}), continuing without GMB ad-attribution:`,
          err,
        );
      }
    }

    const rows = await pullCallsForCompany(
      client.callrailCompanyId,
      opts.fromDate,
      opts.toDate,
      client.signedCaseTag,
      client.signedCaseNameFilters,
      tagCategories,
      client.gmbCallrailNameFilters,
      "PPC",
      callViewRows,
    );

    for (const r of rows) {
      // channelBreakdown is always populated here — gmbCallrailNameFilters
      // is always passed above — so this is what powers the Ads
      // Conversion Tracker x CallRail report's PPC/GMB/PMax split (PMax
      // only appears when callViewRows successfully cross-references a
      // GMB-tracker call as ad-driven — see callrail.ts). rollupCounts is
      // split out into its own column (rollup_breakdown) rather than
      // stored redundantly inside tag_category_breakdown too.
      const channelBreakdown = r.channelBreakdown ?? {};
      const tagCategoryBreakdown = Object.fromEntries(
        Object.entries(channelBreakdown).map(([channel, cb]) => [
          channel,
          {
            totalCalls: cb.totalCalls,
            firstTimeCalls: cb.firstTimeCalls,
            tagCategoryBreakdown: cb.tagCategoryBreakdown,
            // PMax-only call_view reconciliation (see CallrailChannelBucket
            // in callrail.ts) — undefined for every other channel, which
            // JSON.stringify drops from the persisted jsonb, same as if
            // the key were never set.
            callViewRowsTotal: cb.callViewRowsTotal,
            callViewRowsMatched: cb.callViewRowsMatched,
            callViewRowsUnmatched: cb.callViewRowsUnmatched,
          },
        ]),
      );
      const rollupBreakdown = Object.fromEntries(
        Object.entries(channelBreakdown).map(([channel, cb]) => [
          channel,
          cb.rollupCounts,
        ]),
      );

      await db
        .insert(ppcCallrailDaily)
        .values({
          ppcClientId,
          date: r.date,
          totalCalls: r.totalCalls,
          signedCases: r.signedCases,
          tagCategoryBreakdown,
          rollupBreakdown,
        })
        .onConflictDoUpdate({
          target: [ppcCallrailDaily.ppcClientId, ppcCallrailDaily.date],
          set: {
            totalCalls: r.totalCalls,
            signedCases: r.signedCases,
            tagCategoryBreakdown,
            rollupBreakdown,
            ingestedAt: new Date(),
          },
        });
    }

    await db
      .update(ppcClients)
      .set({ lastCallrailSyncAt: new Date(), lastSyncError: null })
      .where(eq(ppcClients.id, ppcClientId));

    await finishJob(jobId, "completed", null);
    return { jobId, daysIngested: rows.length };
  } catch (err) {
    const msg = stringifyError(err);
    await finishJob(jobId, "failed", msg);
    await db
      .update(ppcClients)
      .set({ lastSyncError: msg })
      .where(eq(ppcClients.id, ppcClientId));
    throw err;
  }
}

// Best-effort sweep across every active PPC client with the right link.
// Per-client errors are caught; the loop continues and returns counts.
export async function syncAllGoogleAds(opts: SyncOpts): Promise<{
  synced: number;
  errored: number;
  errors: Array<{ ppcClientId: string; message: string }>;
}> {
  const candidates = await db.query.ppcClients.findMany({
    where: and(
      eq(ppcClients.isActive, true),
      sql`${ppcClients.googleAdsOauthTokenId} is not null`,
      sql`${ppcClients.googleAdsCustomerId} is not null`,
    ),
  });
  // Clients sync concurrently (not one-at-a-time) so a wide date range
  // (e.g. a multi-month backfill) fans out instead of summing per-client
  // durations — needed to fit within a single serverless request.
  const settled = await Promise.allSettled(
    candidates.map((c) => syncGoogleAdsForClient(c.id, opts)),
  );
  let synced = 0;
  let errored = 0;
  const errors: Array<{ ppcClientId: string; message: string }> = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") {
      synced += 1;
    } else {
      errored += 1;
      errors.push({ ppcClientId: candidates[i].id, message: stringifyError(s.reason) });
    }
  });
  return { synced, errored, errors };
}

export async function syncAllCallrail(opts: SyncOpts): Promise<{
  synced: number;
  errored: number;
  errors: Array<{ ppcClientId: string; message: string }>;
}> {
  const candidates = await db.query.ppcClients.findMany({
    where: and(
      eq(ppcClients.isActive, true),
      sql`${ppcClients.callrailCompanyId} is not null`,
    ),
  });
  // Clients sync concurrently (not one-at-a-time) so a wide date range
  // (e.g. a multi-month backfill) fans out instead of summing per-client
  // durations — needed to fit within a single serverless request.
  const settled = await Promise.allSettled(
    candidates.map((c) => syncCallrailForClient(c.id, opts)),
  );
  let synced = 0;
  let errored = 0;
  const errors: Array<{ ppcClientId: string; message: string }> = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") {
      synced += 1;
    } else {
      errored += 1;
      errors.push({ ppcClientId: candidates[i].id, message: stringifyError(s.reason) });
    }
  });
  return { synced, errored, errors };
}
