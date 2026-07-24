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
import { pullDailyMetrics } from "./google-ads";
import { pullCallsForCompany } from "./callrail";

type SyncOpts = {
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
  triggeredBy?: string; // "scheduled" | "manual" | ...
};

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function yesterdayIso(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return toIsoDate(d);
}

export function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return toIsoDate(d);
}

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
    const msg = (err as Error).message;
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

    const tagCategories = await db.query.ppcCallrailTagCategories.findMany({
      where: eq(ppcCallrailTagCategories.ppcClientId, ppcClientId),
    });

    const rows = await pullCallsForCompany(
      client.callrailCompanyId,
      opts.fromDate,
      opts.toDate,
      client.signedCaseTag,
      client.signedCaseNameFilters,
      tagCategories,
      client.gmbCallrailNameFilters,
    );

    for (const r of rows) {
      // channelBreakdown is always populated here — gmbCallrailNameFilters
      // is always passed above — so this is what powers the Ads
      // Conversion Tracker x CallRail report's PPC/GMB split.
      await db
        .insert(ppcCallrailDaily)
        .values({
          ppcClientId,
          date: r.date,
          totalCalls: r.totalCalls,
          signedCases: r.signedCases,
          tagCategoryBreakdown: r.channelBreakdown ?? {},
        })
        .onConflictDoUpdate({
          target: [ppcCallrailDaily.ppcClientId, ppcCallrailDaily.date],
          set: {
            totalCalls: r.totalCalls,
            signedCases: r.signedCases,
            tagCategoryBreakdown: r.channelBreakdown ?? {},
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
    const msg = (err as Error).message;
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
  let synced = 0;
  let errored = 0;
  const errors: Array<{ ppcClientId: string; message: string }> = [];
  for (const c of candidates) {
    try {
      await syncGoogleAdsForClient(c.id, opts);
      synced += 1;
    } catch (e) {
      errored += 1;
      errors.push({ ppcClientId: c.id, message: (e as Error).message });
    }
  }
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
  let synced = 0;
  let errored = 0;
  const errors: Array<{ ppcClientId: string; message: string }> = [];
  for (const c of candidates) {
    try {
      await syncCallrailForClient(c.id, opts);
      synced += 1;
    } catch (e) {
      errored += 1;
      errors.push({ ppcClientId: c.id, message: (e as Error).message });
    }
  }
  return { synced, errored, errors };
}
