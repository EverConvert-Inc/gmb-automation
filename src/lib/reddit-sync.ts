import { eq, inArray, sql } from "drizzle-orm";
import { db } from "./db/client";
import { redditAdAccounts, redditAdsDaily, redditSyncJobs } from "./db/schema";
import { easternWallClockToDate } from "./date-utils";
import {
  listBusinessAdAccounts,
  listMyBusinesses,
  queryBusinessAdAccounts,
  runAdAccountReport,
  toRedditReportHour,
  type RedditAdAccount as ApiAdAccount,
} from "./reddit-ads";
import { getRedditAccessToken, listRedditCredentials } from "./reddit-ads-token";

// Reddit Ads spend sync. Standalone from ppc-sync/lsa-sync: own tables, own
// jobs, nothing written to or read from PPC/LSA.
//
// Every report is requested in America/New_York (not each account's own
// time zone), so a stored `date` is always an Eastern calendar date and
// lines up with the PPC/LSA reports' Eastern dates.

export const REDDIT_REPORT_TIME_ZONE = "America/New_York";

type SyncOpts = {
  fromDate: string; // YYYY-MM-DD, Eastern
  toDate: string; // YYYY-MM-DD, Eastern, inclusive
  triggeredBy?: string; // "scheduled" | "manual"
};

// See ppc-sync.ts: a non-Error rejection cast with `(err as Error).message`
// is undefined, which drizzle's .set() silently drops.
function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

async function startJob(
  adAccountId: string | null,
  kind: "spend" | "discovery",
  triggeredBy: string,
): Promise<string> {
  const [row] = await db
    .insert(redditSyncJobs)
    .values({ adAccountId, kind, status: "running", startedAt: new Date(), triggeredBy })
    .returning();
  return row.id;
}

async function finishJob(jobId: string, status: "completed" | "failed", errorMessage: string | null) {
  await db
    .update(redditSyncJobs)
    .set({ status, completedAt: new Date(), errorMessage: errorMessage?.slice(0, 2000) ?? null })
    .where(eq(redditSyncJobs.id, jobId));
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function datesInRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

// Eastern midnight of `iso`, as the whole-UTC-hour string the reports
// endpoint requires (04:00Z under EDT, 05:00Z under EST).
export function easternMidnightReportHour(iso: string): string {
  const d = easternWallClockToDate(`${iso} 00:00:00`);
  if (!d) throw new Error(`Bad date: ${iso}`);
  return toRedditReportHour(d);
}

// The window is bounded at Eastern midnights AND time_zone_id is Eastern.
// Which of the two Reddit actually uses to cut days was never confirmed
// live; setting both the same way gives Eastern days under either reading.
export function spendReportWindow(fromDate: string, toDate: string) {
  return {
    startsAt: easternMidnightReportHour(fromDate),
    endsAt: easternMidnightReportHour(addDaysIso(toDate, 1)),
    timeZoneId: REDDIT_REPORT_TIME_ZONE,
  };
}

// Folds report rows into one micros total per date, zero-filling every date
// in the window so a day whose spend dropped to nothing overwrites a stale
// earlier figure rather than keeping it. Rows outside the window are
// ignored.
export function spendByDate(
  rows: Array<{ date?: string | null; spend?: number | null }>,
  fromDate: string,
  toDate: string,
): Map<string, bigint> {
  const out = new Map<string, bigint>(datesInRange(fromDate, toDate).map((d) => [d, 0n]));
  for (const r of rows) {
    const date = r.date?.slice(0, 10);
    if (!date || !out.has(date)) continue;
    out.set(date, (out.get(date) ?? 0n) + BigInt(Math.round(r.spend ?? 0)));
  }
  return out;
}

export type DiscoveryResult = { found: number; added: number; errors: string[] };

// Ad accounts the connected login can see. The plain business list misses
// partner-shared accounts (confirmed live: it returned only our own
// account, while /ad_accounts/query also returned the six shared client
// accounts), so both are unioned. Only Reddit-side fields are refreshed on
// existing rows; the client mapping and active flag are never touched.
export async function discoverRedditAccounts(
  accessToken: string,
  oauthCredentialId: string,
  triggeredBy: string,
): Promise<DiscoveryResult> {
  const jobId = await startJob(null, "discovery", triggeredBy);
  const errors: string[] = [];
  try {
    const { items: businesses } = await listMyBusinesses(accessToken);
    const ourBusinessIds = new Set(businesses.map((b) => b.id));
    const accounts = new Map<string, ApiAdAccount>();
    for (const b of businesses) {
      for (const pull of [listBusinessAdAccounts, queryBusinessAdAccounts]) {
        try {
          const { items } = await pull(accessToken, b.id);
          for (const a of items) accounts.set(a.id, a);
        } catch (e) {
          errors.push(`${b.name}: ${stringifyError(e)}`);
        }
      }
    }

    const ids = [...accounts.keys()];
    const existing = ids.length
      ? await db
          .select({ id: redditAdAccounts.redditAdAccountId })
          .from(redditAdAccounts)
          .where(inArray(redditAdAccounts.redditAdAccountId, ids))
      : [];
    const now = new Date();
    for (const a of accounts.values()) {
      const values = {
        name: a.name,
        ownerBusinessId: a.business_id,
        isShared: a.business_id != null && !ourBusinessIds.has(a.business_id),
        currency: a.currency,
        timeZoneId: a.time_zone_id,
        oauthCredentialId,
        lastSeenAt: now,
        updatedAt: now,
      };
      await db
        .insert(redditAdAccounts)
        .values({ redditAdAccountId: a.id, ...values })
        .onConflictDoUpdate({ target: redditAdAccounts.redditAdAccountId, set: values });
    }

    const result = { found: accounts.size, added: accounts.size - existing.length, errors };
    await finishJob(jobId, errors.length ? "failed" : "completed", errors.join("; ") || null);
    return result;
  } catch (e) {
    await finishJob(jobId, "failed", stringifyError(e));
    throw e;
  }
}

type AccountRow = typeof redditAdAccounts.$inferSelect;

// Writes only after a successful pull, so a failed request never wipes
// previously good rows.
export async function syncRedditSpendForAccount(
  accessToken: string,
  account: AccountRow,
  opts: SyncOpts,
): Promise<void> {
  const triggeredBy = opts.triggeredBy ?? "manual";
  const jobId = await startJob(account.id, "spend", triggeredBy);
  try {
    const { items } = await runAdAccountReport(accessToken, account.redditAdAccountId, {
      breakdowns: ["DATE"],
      fields: ["SPEND"],
      ...spendReportWindow(opts.fromDate, opts.toDate),
    });
    const byDate = spendByDate(items, opts.fromDate, opts.toDate);
    const now = new Date();
    const rows = [...byDate].map(([date, spendMicros]) => ({
      adAccountId: account.id,
      date,
      spendMicros,
      ingestedAt: now,
    }));
    if (rows.length) {
      await db
        .insert(redditAdsDaily)
        .values(rows)
        .onConflictDoUpdate({
          target: [redditAdsDaily.adAccountId, redditAdsDaily.date],
          set: { spendMicros: sql`excluded.spend_micros`, ingestedAt: now },
        });
    }
    await db
      .update(redditAdAccounts)
      .set({ lastSyncAt: now, lastSyncError: null, updatedAt: now })
      .where(eq(redditAdAccounts.id, account.id));
    await finishJob(jobId, "completed", null);
  } catch (e) {
    const msg = stringifyError(e);
    await db
      .update(redditAdAccounts)
      .set({ lastSyncError: msg.slice(0, 2000), updatedAt: new Date() })
      .where(eq(redditAdAccounts.id, account.id));
    await finishJob(jobId, "failed", msg);
    throw e;
  }
}

export type RedditSweepResult = {
  discovery: DiscoveryResult | { error: string };
  synced: number;
  errored: number;
  errors: Array<{ account: string; message: string }>;
};

async function connectedToken(): Promise<{ token: string; credentialId: string }> {
  const [cred] = await listRedditCredentials();
  if (!cred) throw new Error("Reddit Ads isn't connected. Connect it at /reddit/accounts.");
  return { token: await getRedditAccessToken(cred), credentialId: cred.id };
}

export async function runRedditDiscovery(triggeredBy: string): Promise<DiscoveryResult> {
  const { token, credentialId } = await connectedToken();
  return discoverRedditAccounts(token, credentialId, triggeredBy);
}

// Discovery first (so a newly shared account starts syncing with no manual
// step), then spend for every active account. Accounts run one at a time
// rather than concurrently like ppc-sync's clients: it's one request per
// account, and Reddit's 60-requests-per-minute limit is per authorized
// user, so fanning out buys little and risks 429s.
export async function syncAllRedditSpend(opts: SyncOpts): Promise<RedditSweepResult> {
  const triggeredBy = opts.triggeredBy ?? "manual";
  const { token, credentialId } = await connectedToken();

  let discovery: RedditSweepResult["discovery"];
  try {
    discovery = await discoverRedditAccounts(token, credentialId, triggeredBy);
  } catch (e) {
    // Known accounts still sync if discovery itself fails.
    discovery = { error: stringifyError(e) };
  }

  const accounts = await db.query.redditAdAccounts.findMany({
    where: eq(redditAdAccounts.isActive, true),
  });
  let synced = 0;
  const errors: RedditSweepResult["errors"] = [];
  for (const account of accounts) {
    try {
      await syncRedditSpendForAccount(token, account, { ...opts, triggeredBy });
      synced += 1;
    } catch (e) {
      errors.push({ account: account.name, message: stringifyError(e) });
    }
  }
  return { discovery, synced, errored: errors.length, errors };
}
