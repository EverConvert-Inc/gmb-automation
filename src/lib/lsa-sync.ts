import { and, eq, sql } from "drizzle-orm";
import { db } from "./db/client";
import {
  lsaCallrailTagCategories,
  lsaClients,
  lsaLeadsDaily,
  lsaSyncJobs,
  oauthCredentials,
  ppcClients,
} from "./db/schema";
import { decryptString } from "./crypto";
import { pullLocalServicesCost, pullLocalServicesLeads } from "./google-ads";
import { pullCallsForCompany } from "./callrail";
import { yesterdayIsoEastern, daysAgoIsoEastern } from "./date-utils";

type SyncOpts = {
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
  triggeredBy?: string; // "scheduled" | "manual" | "manual-backfill" | ...
};

// Re-exported under the original names so every existing caller (cron
// routes, sync-now routes) is unaffected — see date-utils.ts for why this
// is Eastern-based rather than UTC.
export const yesterdayIso = yesterdayIsoEastern;
export const daysAgoIso = daysAgoIsoEastern;

async function startJob(
  lsaClientId: string | null,
  kind: "google_ads" | "callrail",
  triggeredBy: string,
): Promise<string> {
  const [row] = await db
    .insert(lsaSyncJobs)
    .values({
      lsaClientId,
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
    .update(lsaSyncJobs)
    .set({
      status,
      completedAt: new Date(),
      errorMessage: errorMessage?.slice(0, 2000) ?? null,
    })
    .where(eq(lsaSyncJobs.id, jobId));
}

type DayBucket = {
  date: string;
  phoneCallCount: number;
  messageCount: number;
  bookingCount: number;
  chargedCount: number;
  statusBreakdown: Record<string, number>;
  costMicros: bigint;
  signedCases: number;
  // Flat, blended tag category counts for the Ads Conversion Tracker x
  // CallRail report — flat when this client's CallRail company has a
  // matching PPC record (GMB stays owned by that side, no split here),
  // channel-nested (keyed "LSA"/"GMB") when it doesn't. See the
  // hasMatchingPpcClient check in the CallRail sync block below.
  tagCategoryBreakdown: Record<string, unknown>;
  // Per-call real/junk/unclassified counts (capped at 1 per call) — see
  // CallrailRollupCounts in callrail.ts. Same flat-vs-nested split as
  // tagCategoryBreakdown above.
  rollupCounts: Record<string, unknown>;
  // CallRail's first_call flag, counted per day. Same flat-vs-nested split
  // as tagCategoryBreakdown/rollupCounts above — a flat number (today's
  // shape) or a per-channel object (keyed "LSA"/"GMB").
  firstTimeCalls: unknown;
  adsFetched: boolean;
  callrailFetched: boolean;
};

function emptyBucket(date: string): DayBucket {
  return {
    date,
    phoneCallCount: 0,
    messageCount: 0,
    bookingCount: 0,
    chargedCount: 0,
    statusBreakdown: {},
    costMicros: 0n,
    signedCases: 0,
    tagCategoryBreakdown: {},
    rollupCounts: { real: 0, junk: 0, unclassified: 0 },
    firstTimeCalls: 0,
    adsFetched: false,
    callrailFetched: false,
  };
}

// Pulls Google Ads (local_services_lead + LOCAL_SERVICES campaign cost) and
// CallRail (signed cases) independently, merges both into one row per day,
// and upserts into lsa_leads_daily. Unlike ppc-sync.ts's two separate
// per-source sync functions, this bundles both sources into a single
// client-level sync because lsa_leads_daily is one merged fact table, not
// a join at report time (see schema.ts comment on lsa_leads_daily).
//
// Each source is tried independently and failures don't block the other:
// if CallRail fails but Ads succeeds, the Ads-derived fields still get
// written. The upsert's `set` clause only includes fields for a source
// that actually succeeded this run, so a transient failure on one side
// never overwrites previously-good data from the other side with zeros.
//
// Every failure is both recorded to lsa_sync_jobs AND logged via
// console.error — ppc-callrail-sync's cron route recorded failures to the
// DB but never logged them anywhere a human would see without querying
// the table directly; this closes that gap from day one.
export async function syncLsaForClient(
  lsaClientId: string,
  opts: SyncOpts,
): Promise<{
  daysWritten: number;
  adsJobId: string | null;
  callrailJobId: string | null;
  adsError: string | null;
  callrailError: string | null;
}> {
  const triggeredBy = opts.triggeredBy ?? "manual";
  const client = await db.query.lsaClients.findFirst({
    where: eq(lsaClients.id, lsaClientId),
  });
  if (!client) throw new Error(`LSA client ${lsaClientId} not found`);
  if (!client.googleAdsCustomerId && !client.callrailCompanyId) {
    throw new Error("LSA client is not linked to Google Ads or CallRail");
  }

  const byDate = new Map<string, DayBucket>();
  function bucket(date: string): DayBucket {
    const existing = byDate.get(date);
    if (existing) return existing;
    const created = emptyBucket(date);
    byDate.set(date, created);
    return created;
  }

  let adsJobId: string | null = null;
  let adsError: string | null = null;
  // Triggers on googleAdsCustomerId alone — a customer id set without a
  // linked OAuth credential is a real misconfiguration (e.g. the operator
  // typed a customer id but the OAuth attach step never completed), not a
  // "nothing to do here" case. That combination must still produce a
  // recorded, logged failure below rather than silently skipping the
  // client, which is the exact gap this rebuild exists to close.
  if (client.googleAdsCustomerId) {
    adsJobId = await startJob(lsaClientId, "google_ads", triggeredBy);
    try {
      if (!client.googleAdsOauthTokenId) {
        throw new Error(
          "LSA client has a Google Ads customer id but no linked OAuth credential",
        );
      }
      const cred = await db.query.oauthCredentials.findFirst({
        where: eq(oauthCredentials.id, client.googleAdsOauthTokenId),
      });
      if (!cred) throw new Error("OAuth credential row missing");
      const refreshToken = decryptString(cred.refreshTokenEncrypted);

      const [leadRows, costRows] = await Promise.all([
        pullLocalServicesLeads(
          refreshToken,
          client.googleAdsCustomerId,
          client.loginCustomerId ?? undefined,
          opts.fromDate,
          opts.toDate,
        ),
        pullLocalServicesCost(
          refreshToken,
          client.googleAdsCustomerId,
          client.loginCustomerId ?? undefined,
          opts.fromDate,
          opts.toDate,
        ),
      ]);

      for (const r of leadRows) {
        const b = bucket(r.date);
        b.phoneCallCount = r.phoneCallCount;
        b.messageCount = r.messageCount;
        b.bookingCount = r.bookingCount;
        b.chargedCount = r.chargedCount;
        b.statusBreakdown = r.statusBreakdown;
        b.adsFetched = true;
      }
      for (const r of costRows) {
        const b = bucket(r.date);
        b.costMicros = r.costMicros;
        b.adsFetched = true;
      }

      await db
        .update(lsaClients)
        .set({ lastAdsSyncAt: new Date(), lastSyncError: null })
        .where(eq(lsaClients.id, lsaClientId));
      await finishJob(adsJobId, "completed", null);
    } catch (err) {
      const msg = (err as Error).message;
      adsError = msg;
      console.error(`[lsa-sync] google_ads failed for lsa_client ${lsaClientId}:`, msg);
      await finishJob(adsJobId, "failed", msg);
      await db
        .update(lsaClients)
        .set({ lastSyncError: msg })
        .where(eq(lsaClients.id, lsaClientId));
    }
  }

  let callrailJobId: string | null = null;
  let callrailError: string | null = null;
  if (client.callrailCompanyId) {
    callrailJobId = await startJob(lsaClientId, "callrail", triggeredBy);
    try {
      // rollup is stored as plain text (no DB-level enum); narrowed here
      // since the tag-category API routes are the only writers and
      // always validate it against z.enum(["real", "junk"]) before
      // insert/update.
      const tagCategories = (
        await db.query.lsaCallrailTagCategories.findMany({
          where: eq(lsaCallrailTagCategories.lsaClientId, lsaClientId),
        })
      ).map((c) => ({ ...c, rollup: c.rollup as "real" | "junk" }));

      // GMB classification is only ever done from one side of a shared
      // CallRail company — if a ppc_clients row shares this company_id,
      // PPC already classifies GMB for it, and doing it here too would
      // double-count the same calls under both channels (confirmed: every
      // client sharing a company has disjoint, single-channel tracker
      // names, so this is purely about not re-deriving the same GMB calls
      // twice, not about tracker-name ambiguity). Only pass gmbNameFilters
      // — and only then does channelBreakdown/the nested storage shape
      // apply — when no such PPC row exists.
      const hasMatchingPpcClient = !!(
        await db.query.ppcClients.findFirst({
          where: eq(ppcClients.callrailCompanyId, client.callrailCompanyId),
          columns: { id: true },
        })
      );
      // Also gated on an actual filter being configured — a client with no
      // PPC match but an empty gmbCallrailNameFilters (not yet set up)
      // keeps today's flat storage shape rather than switching to a
      // channel-nested one containing only "LSA", with nothing to gain.
      const gmbNameFilters =
        hasMatchingPpcClient || client.gmbCallrailNameFilters.length === 0
          ? undefined
          : client.gmbCallrailNameFilters;

      const rows = await pullCallsForCompany(
        client.callrailCompanyId,
        opts.fromDate,
        opts.toDate,
        client.signedCaseTag,
        client.signedCaseNameFilters,
        tagCategories,
        gmbNameFilters,
        "LSA",
      );
      for (const r of rows) {
        const b = bucket(r.date);
        b.signedCases = r.signedCases;
        // A day where this client had calls but none matched either the
        // LSA or GMB filter leaves channelBreakdown genuinely empty ({}) —
        // still truthy, so also checking its key count here to fall
        // through to the flat branch below instead of writing three
        // ambiguous empty objects (which the reader would otherwise have
        // to reconstruct a zero value from, rather than a clean 0/{}).
        if (r.channelBreakdown && Object.keys(r.channelBreakdown).length > 0) {
          // No matching PPC record — this client owns its own GMB split.
          // Store channel-nested, mirroring ppc_callrail_daily's shape.
          b.tagCategoryBreakdown = Object.fromEntries(
            Object.entries(r.channelBreakdown).map(([channel, cb]) => [
              channel,
              cb.tagCategoryBreakdown,
            ]),
          );
          b.rollupCounts = Object.fromEntries(
            Object.entries(r.channelBreakdown).map(([channel, cb]) => [
              channel,
              cb.rollupCounts,
            ]),
          );
          b.firstTimeCalls = Object.fromEntries(
            Object.entries(r.channelBreakdown).map(([channel, cb]) => [
              channel,
              cb.firstTimeCalls,
            ]),
          );
        } else {
          // Shared-company client — unchanged, flat shape.
          b.tagCategoryBreakdown = r.tagCategoryBreakdown;
          b.rollupCounts = r.rollupCounts;
          b.firstTimeCalls = r.firstTimeCalls;
        }
        b.callrailFetched = true;
      }

      await db
        .update(lsaClients)
        .set({ lastCallrailSyncAt: new Date(), lastSyncError: null })
        .where(eq(lsaClients.id, lsaClientId));
      await finishJob(callrailJobId, "completed", null);
    } catch (err) {
      const msg = (err as Error).message;
      callrailError = msg;
      console.error(`[lsa-sync] callrail failed for lsa_client ${lsaClientId}:`, msg);
      await finishJob(callrailJobId, "failed", msg);
      await db
        .update(lsaClients)
        .set({ lastSyncError: msg })
        .where(eq(lsaClients.id, lsaClientId));
    }
  }

  for (const row of byDate.values()) {
    const updateSet: Record<string, unknown> = { ingestedAt: new Date() };
    if (row.adsFetched) {
      updateSet.phoneCallCount = row.phoneCallCount;
      updateSet.messageCount = row.messageCount;
      updateSet.bookingCount = row.bookingCount;
      updateSet.chargedCount = row.chargedCount;
      updateSet.leadStatusBreakdown = row.statusBreakdown;
      updateSet.costMicros = row.costMicros;
    }
    if (row.callrailFetched) {
      updateSet.signedCases = row.signedCases;
      updateSet.tagCategoryBreakdown = row.tagCategoryBreakdown;
      updateSet.rollupBreakdown = row.rollupCounts;
      updateSet.firstTimeCalls = row.firstTimeCalls;
    }

    await db
      .insert(lsaLeadsDaily)
      .values({
        lsaClientId,
        date: row.date,
        phoneCallCount: row.phoneCallCount,
        messageCount: row.messageCount,
        bookingCount: row.bookingCount,
        chargedCount: row.chargedCount,
        leadStatusBreakdown: row.statusBreakdown,
        costMicros: row.costMicros,
        signedCases: row.signedCases,
        tagCategoryBreakdown: row.tagCategoryBreakdown,
        rollupBreakdown: row.rollupCounts,
        firstTimeCalls: row.firstTimeCalls,
      })
      .onConflictDoUpdate({
        target: [lsaLeadsDaily.lsaClientId, lsaLeadsDaily.date],
        set: updateSet,
      });
  }

  if (adsError && callrailError) {
    throw new Error(`google_ads: ${adsError}; callrail: ${callrailError}`);
  }

  return { daysWritten: byDate.size, adsJobId, callrailJobId, adsError, callrailError };
}

// Best-effort sweep across every active LSA client linked to at least one
// source. Per-client errors are caught; the loop continues. A client with
// only one source failing this run is still counted as synced (the other
// source's data did get written) but surfaced in `partialErrors` so it's
// not silently lost — only a client where both sources fail (or the
// client-level sync throws before either source runs) counts as `errored`.
export async function syncAllLsaClients(opts: SyncOpts): Promise<{
  synced: number;
  errored: number;
  errors: Array<{ lsaClientId: string; message: string }>;
  partialErrors: Array<{ lsaClientId: string; message: string }>;
}> {
  const candidates = await db.query.lsaClients.findMany({
    where: and(
      eq(lsaClients.isActive, true),
      sql`(${lsaClients.googleAdsCustomerId} is not null or ${lsaClients.callrailCompanyId} is not null)`,
    ),
  });
  // Clients sync concurrently (not one-at-a-time) so a wide date range
  // (e.g. a multi-month backfill) fans out instead of summing per-client
  // durations — needed to fit within a single serverless request.
  const settled = await Promise.allSettled(
    candidates.map((c) => syncLsaForClient(c.id, opts)),
  );
  let synced = 0;
  let errored = 0;
  const errors: Array<{ lsaClientId: string; message: string }> = [];
  const partialErrors: Array<{ lsaClientId: string; message: string }> = [];
  settled.forEach((s, i) => {
    const c = candidates[i];
    if (s.status === "fulfilled") {
      synced += 1;
      const result = s.value;
      if (result.adsError) {
        partialErrors.push({ lsaClientId: c.id, message: `google_ads: ${result.adsError}` });
      }
      if (result.callrailError) {
        partialErrors.push({ lsaClientId: c.id, message: `callrail: ${result.callrailError}` });
      }
    } else {
      errored += 1;
      const message = (s.reason as Error).message;
      console.error(`[lsa-sync] client ${c.id} failed entirely:`, message);
      errors.push({ lsaClientId: c.id, message });
    }
  });
  return { synced, errored, errors, partialErrors };
}
