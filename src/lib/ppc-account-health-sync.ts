import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "./db/client";
import { oauthCredentials, ppcAccountHealthDaily, ppcClients, ppcSyncJobs } from "./db/schema";
import { decryptString } from "./crypto";
import { pullAccountHealth } from "./google-ads";
import { monthToDateWindow, rollupBudgets } from "./ads-account-health";
import { getConversionAudit } from "./queries-ads-dashboard";
import { sliceClientBatch, type ClientBatch } from "./ppc-search-terms-sync";

// Account-health snapshot for the /ads overview: one row per PPC client per
// day in ppc_account_health_daily, month to date through `through`.
//
// Separate from the other PPC syncs: its own job kind, its own table, and a
// failure here never touches their data or ppc_clients.lastSyncError.
//
// Budgets and spend are required — without them there is no row. Impression
// share, optimization score and the conversion audit are optional parts:
// one failing is recorded in pull_errors and, on a re-run for the same day,
// leaves that part's previously stored values alone rather than nulling
// them.

const JOB_KIND = "google_ads_account_health";
// Each client is ~9 small live queries and one upsert; nothing is held in
// memory, but stay under the 5-connection pool.
const CLIENT_CONCURRENCY = 3;

// See ppc-sync.ts's stringifyError for why caught errors are never cast to
// Error directly.
function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
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

const share = (v: number | null) => (v === null ? null : v.toFixed(4));

type SyncOpts = { through: string; triggeredBy?: string };

export async function syncAccountHealthForClient(
  ppcClientId: string,
  opts: SyncOpts,
): Promise<{ jobId: string; partErrors: Record<string, string> }> {
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
    const client = await db.query.ppcClients.findFirst({ where: eq(ppcClients.id, ppcClientId) });
    if (!client) throw new Error(`PPC client ${ppcClientId} not found`);
    if (!client.googleAdsOauthTokenId || !client.googleAdsCustomerId) {
      throw new Error("PPC client is not linked to Google Ads");
    }
    const cred = await db.query.oauthCredentials.findFirst({
      where: eq(oauthCredentials.id, client.googleAdsOauthTokenId),
    });
    if (!cred) throw new Error("OAuth credential row missing");
    const refreshToken = decryptString(cred.refreshTokenEncrypted);

    const w = monthToDateWindow(opts.through);
    const [pull, audit] = await Promise.all([
      pullAccountHealth(refreshToken, client.googleAdsCustomerId, w.monthStart, w.through),
      getConversionAudit(ppcClientId, { from: w.monthStart, to: w.through }, null),
    ]);
    const budgets = rollupBudgets(pull.budgetCampaigns);
    const partErrors = { ...pull.errors };
    if (!audit.ok) partErrors.conversions = audit.error;

    // Optional parts are written only when they succeeded, so the update
    // branch below keeps an earlier good value for a part that failed now.
    const optional: Partial<typeof ppcAccountHealthDaily.$inferInsert> = {};
    if (!("impressionShare" in pull.errors)) optional.searchImpressionShare = share(pull.impressionShare);
    if (!("budgetLostShare" in pull.errors)) optional.searchBudgetLostShare = share(pull.budgetLostShare);
    if (!("rankLostShare" in pull.errors)) optional.searchRankLostShare = share(pull.rankLostShare);
    if (!("optimizationScore" in pull.errors)) optional.optimizationScore = share(pull.optimizationScore);
    if (audit.ok) {
      const s = audit.audit.summary;
      optional.conversions = s.totalConversions.toFixed(2);
      optional.junkConversions = s.junkConversions.toFixed(2);
      optional.reviewConversions = s.reviewConversions.toFixed(2);
    }
    const required = {
      monthStart: w.monthStart,
      daysElapsed: w.daysElapsed,
      dailyBudgetMicros: BigInt(Math.round(budgets.dailyBudget * 1_000_000)),
      budgetCount: budgets.budgets.length,
      sharedBudgetCount: budgets.sharedBudgetCount,
      excludedBudgetCount: budgets.excludedBudgetCount,
      mtdSpendMicros: pull.mtdSpendMicros,
      pullErrors:
        Object.keys(partErrors).length > 0
          ? Object.entries(partErrors)
              .map(([k, v]) => `${k}: ${v}`)
              .join(" | ")
              .slice(0, 2000)
          : null,
    };

    await db
      .insert(ppcAccountHealthDaily)
      .values({ ppcClientId, date: w.through, ...required, ...optional })
      .onConflictDoUpdate({
        target: [ppcAccountHealthDaily.ppcClientId, ppcAccountHealthDaily.date],
        set: { ...required, ...optional, ingestedAt: new Date() },
      });

    await db
      .update(ppcSyncJobs)
      .set({ status: "completed", completedAt: new Date(), errorMessage: required.pullErrors })
      .where(eq(ppcSyncJobs.id, jobId));
    return { jobId, partErrors };
  } catch (err) {
    const msg = stringifyError(err);
    await db
      .update(ppcSyncJobs)
      .set({ status: "failed", completedAt: new Date(), errorMessage: msg.slice(0, 2000) })
      .where(eq(ppcSyncJobs.id, jobId));
    throw err;
  }
}

// Best-effort sweep across active, Ads-linked PPC clients (all, or one
// batch — same paging as the search-terms backfill). Per-client errors are
// collected, never thrown.
export async function syncAllAccountHealth(opts: SyncOpts & { batch?: ClientBatch }): Promise<{
  totalClients: number;
  offset: number;
  nextOffset: number | null;
  synced: number;
  errored: number;
  clients: Array<{ ppcClientId: string; name: string; seconds: number; ok: boolean; partErrors: string[] }>;
  errors: Array<{ ppcClientId: string; message: string }>;
}> {
  const candidates = await db.query.ppcClients.findMany({
    where: and(
      eq(ppcClients.isActive, true),
      sql`${ppcClients.googleAdsOauthTokenId} is not null`,
      sql`${ppcClients.googleAdsCustomerId} is not null`,
    ),
    orderBy: [asc(ppcClients.createdAt), asc(ppcClients.id)],
  });
  const { selected, nextOffset } = sliceClientBatch(candidates, opts.batch);
  const result = {
    totalClients: candidates.length,
    offset: opts.batch?.offset ?? 0,
    nextOffset,
    synced: 0,
    errored: 0,
    clients: [] as Array<{ ppcClientId: string; name: string; seconds: number; ok: boolean; partErrors: string[] }>,
    errors: [] as Array<{ ppcClientId: string; message: string }>,
  };
  const queue = [...selected];
  await Promise.all(
    Array.from({ length: Math.min(CLIENT_CONCURRENCY, queue.length) }, async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        const started = Date.now();
        const seconds = () => Math.round((Date.now() - started) / 100) / 10;
        try {
          const r = await syncAccountHealthForClient(c.id, {
            through: opts.through,
            triggeredBy: opts.triggeredBy,
          });
          result.synced += 1;
          result.clients.push({
            ppcClientId: c.id,
            name: c.name,
            seconds: seconds(),
            ok: true,
            partErrors: Object.keys(r.partErrors),
          });
        } catch (err) {
          result.errored += 1;
          result.errors.push({ ppcClientId: c.id, message: stringifyError(err) });
          result.clients.push({ ppcClientId: c.id, name: c.name, seconds: seconds(), ok: false, partErrors: [] });
        }
      }
    }),
  );
  return result;
}
