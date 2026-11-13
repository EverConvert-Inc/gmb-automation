import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "./db/client";
import {
  ppcAccountHealthDaily,
  ppcCallrailDaily,
  ppcClients,
  ppcSearchCampaignsDaily,
  ppcSearchTermsDaily,
  ppcSyncJobs,
} from "./db/schema";
import {
  compareByAttention,
  HEALTH_THRESHOLDS,
  daysBetween,
  healthFlags,
  junkShare,
  monthToDateWindow,
  pacing,
  wastedShare,
  type HealthFlag,
} from "./ads-account-health";
import { SYNC_COVERAGE_CAMPAIGN_ID } from "./ppc-search-terms-sync";

// Read side of the /ads account-health overview: one row per active,
// Ads-linked PPC client, month to date through `through`. Stored data only
// — no Google call on page load.
//
// Each row joins four sources, all for the same month-to-date window:
//   - the client's latest ppc_account_health_daily snapshot (budget,
//     spend, account-level impression share, optimization score, junk);
//   - CallRail signed cases from ppc_callrail_daily (what /ppc sums);
//   - Search spend and zero-conversion search-term spend from the
//     search-terms sync's tables, with its coverage markers saying whether
//     that window is fully synced.

export type AccountHealthRow = {
  id: string;
  name: string;
  flags: HealthFlag[];
  // Null = no snapshot yet.
  snapshotDate: string | null;
  snapshotAgeDays: number | null;
  pullErrors: string | null;
  lastSyncFailed: string | null;
  dailyBudget: number;
  sharedBudgetCount: number;
  mtdSpend: number;
  expectedSpend: number;
  pacingRatio: number | null;
  impressionShare: number | null;
  budgetLost: number | null;
  rankLost: number | null;
  optimizationScore: number | null;
  conversions: number | null;
  junkConversions: number | null;
  junkShare: number | null;
  // Null = no CallRail company linked.
  signedCases: number | null;
  costPerSigned: number | null;
  searchSpend: number;
  wastedSpend: number;
  wastedShare: number | null;
  // Days of the window the search-terms sync has covered.
  searchSyncedDays: number;
};

export type AccountHealthOverview = {
  monthStart: string;
  through: string;
  daysElapsed: number;
  rows: AccountHealthRow[];
};

const micros = (v: bigint | string | number | null | undefined) => Number(v ?? 0) / 1_000_000;
const nullable = (v: string | null) => (v === null ? null : Number(v));

export async function getAccountHealthOverview(through: string): Promise<AccountHealthOverview> {
  const w = monthToDateWindow(through);
  const inWindow = <T extends { date: unknown }>(t: T) =>
    and(gte(t.date as never, w.monthStart), lte(t.date as never, w.through));

  // Zero-conversion terms are judged per term over the whole window, as on
  // the per-client search-terms page: a term that converted on any day is
  // not wasted spend.
  const perTerm = db
    .select({
      ppcClientId: ppcSearchTermsDaily.ppcClientId,
      costMicros: sql<string>`sum(${ppcSearchTermsDaily.costMicros})`.as("cost_micros"),
      conversions: sql<string>`sum(${ppcSearchTermsDaily.conversions})`.as("conversions"),
    })
    .from(ppcSearchTermsDaily)
    .where(inWindow(ppcSearchTermsDaily))
    .groupBy(ppcSearchTermsDaily.ppcClientId, ppcSearchTermsDaily.searchTerm)
    .as("per_term");

  const [clients, snapshots, signed, search, wasted, jobs] = await Promise.all([
    db.query.ppcClients.findMany({
      where: and(
        eq(ppcClients.isActive, true),
        sql`${ppcClients.googleAdsOauthTokenId} is not null`,
        sql`${ppcClients.googleAdsCustomerId} is not null`,
      ),
      columns: { id: true, name: true, callrailCompanyId: true },
    }),
    // Latest snapshot per client, whatever its date — staleness is shown,
    // not hidden.
    db
      .selectDistinctOn([ppcAccountHealthDaily.ppcClientId])
      .from(ppcAccountHealthDaily)
      .orderBy(ppcAccountHealthDaily.ppcClientId, desc(ppcAccountHealthDaily.date)),
    db
      .select({
        ppcClientId: ppcCallrailDaily.ppcClientId,
        signedCases: sql<string>`sum(${ppcCallrailDaily.signedCases})`,
      })
      .from(ppcCallrailDaily)
      .where(inWindow(ppcCallrailDaily))
      .groupBy(ppcCallrailDaily.ppcClientId),
    db
      .select({
        ppcClientId: ppcSearchCampaignsDaily.ppcClientId,
        costMicros: sql<string>`sum(${ppcSearchCampaignsDaily.costMicros})`,
        syncedDays: sql<string>`count(distinct ${ppcSearchCampaignsDaily.date}) filter (where ${ppcSearchCampaignsDaily.googleAdsCampaignId} = ${SYNC_COVERAGE_CAMPAIGN_ID})`,
      })
      .from(ppcSearchCampaignsDaily)
      .where(inWindow(ppcSearchCampaignsDaily))
      .groupBy(ppcSearchCampaignsDaily.ppcClientId),
    db
      .select({
        ppcClientId: perTerm.ppcClientId,
        costMicros: sql<string>`sum(${perTerm.costMicros})`,
      })
      .from(perTerm)
      .where(sql`${perTerm.conversions} = 0`)
      .groupBy(perTerm.ppcClientId),
    db
      .selectDistinctOn([ppcSyncJobs.ppcClientId], {
        ppcClientId: ppcSyncJobs.ppcClientId,
        status: ppcSyncJobs.status,
        errorMessage: ppcSyncJobs.errorMessage,
      })
      .from(ppcSyncJobs)
      .where(eq(ppcSyncJobs.kind, "google_ads_account_health"))
      .orderBy(ppcSyncJobs.ppcClientId, desc(ppcSyncJobs.createdAt)),
  ]);

  const snapshotBy = new Map(snapshots.map((s) => [s.ppcClientId, s]));
  const signedBy = new Map(signed.map((s) => [s.ppcClientId, Number(s.signedCases ?? 0)]));
  const searchBy = new Map(search.map((s) => [s.ppcClientId, s]));
  const wastedBy = new Map(wasted.map((s) => [s.ppcClientId, micros(s.costMicros)]));
  const jobBy = new Map(jobs.map((j) => [j.ppcClientId, j]));

  const rows = clients.map((c): AccountHealthRow => {
    const s = snapshotBy.get(c.id) ?? null;
    const job = jobBy.get(c.id);
    const lastSyncFailed = job?.status === "failed" ? (job.errorMessage ?? "failed") : null;
    const signedCases = c.callrailCompanyId ? (signedBy.get(c.id) ?? 0) : null;
    const searchRow = searchBy.get(c.id);
    const searchSpend = micros(searchRow?.costMicros);
    const searchSyncedDays = Number(searchRow?.syncedDays ?? 0);
    const wastedSpend = wastedBy.get(c.id) ?? 0;
    const wastedComplete = searchSyncedDays >= w.daysElapsed;

    const dailyBudget = micros(s?.dailyBudgetMicros);
    const mtdSpend = micros(s?.mtdSpendMicros);
    const pace = pacing(dailyBudget, mtdSpend, s?.daysElapsed ?? 0);
    const conversions = nullable(s?.conversions ?? null);
    const junkConversions = nullable(s?.junkConversions ?? null);
    // A snapshot from another month describes a different window than the
    // signed and wasted figures beside it, so it counts as stale however
    // recent it is.
    const snapshotAgeDays = s
      ? s.monthStart === w.monthStart
        ? daysBetween(s.date, w.through)
        : Math.max(daysBetween(s.date, w.through), HEALTH_THRESHOLDS.staleDays + 1)
      : null;

    const flags = healthFlags({
      snapshot: s
        ? {
            ageDays: snapshotAgeDays ?? 0,
            dailyBudget,
            mtdSpend,
            daysElapsed: s.daysElapsed,
            budgetLost: nullable(s.searchBudgetLostShare),
            rankLost: nullable(s.searchRankLostShare),
            optimizationScore: nullable(s.optimizationScore),
            conversions,
            junkConversions,
          }
        : null,
      lastSyncFailed: lastSyncFailed !== null,
      signedCases,
      searchSpend,
      wastedSpend,
      wastedComplete,
    });

    return {
      id: c.id,
      name: c.name,
      flags,
      snapshotDate: s?.date ?? null,
      snapshotAgeDays,
      pullErrors: s?.pullErrors ?? null,
      lastSyncFailed,
      dailyBudget,
      sharedBudgetCount: s?.sharedBudgetCount ?? 0,
      mtdSpend,
      expectedSpend: pace.expected,
      pacingRatio: pace.ratio,
      impressionShare: nullable(s?.searchImpressionShare ?? null),
      budgetLost: nullable(s?.searchBudgetLostShare ?? null),
      rankLost: nullable(s?.searchRankLostShare ?? null),
      optimizationScore: nullable(s?.optimizationScore ?? null),
      conversions,
      junkConversions,
      junkShare: junkShare(conversions, junkConversions),
      signedCases,
      costPerSigned: signedCases !== null && signedCases > 0 && s ? mtdSpend / signedCases : null,
      searchSpend,
      wastedSpend,
      wastedShare: wastedShare({ searchSpend, wastedSpend, wastedComplete }),
      searchSyncedDays,
    };
  });

  return { ...w, rows: rows.sort(compareByAttention) };
}
