import { and, desc, eq, gt, gte, lte, sql } from "drizzle-orm";
import { db } from "./db/client";
import {
  ppcAccountHealthDaily,
  ppcAdsDaily,
  ppcCallrailDaily,
  ppcClients,
  ppcSearchCampaignsDaily,
  ppcSearchTermsDaily,
  ppcSyncJobs,
} from "./db/schema";
import {
  TRIAGE,
  addDays,
  compareByTriage,
  daysBetween,
  junkShare,
  median,
  monthToDateWindow,
  quantile,
  readPacing,
  triage,
  type PacingRead,
  type Portfolio,
  type Triage,
  type TriageInputs,
} from "./ads-account-health";
import { SYNC_COVERAGE_CAMPAIGN_ID } from "./ppc-search-terms-sync";

// Read side of the /ads account-health overview: one row per active,
// Ads-linked PPC client, triaged. Stored data only — no Google call on page
// load. Google Ads (PPC) accounts only; LSA has its own tables and is not
// read here.
//
// Each figure is read over the window that suits it, and the page labels
// each one:
//   - month to date: spend, conversions and junk share, impression share
//     and optimization score (the client's latest ppc_account_health_daily
//     snapshot), and signed cases (ppc_callrail_daily);
//   - the last few days at the current budget: pacing, from the snapshots'
//     own (budget, day spend) pairs — see readPacing;
//   - 180 days: spend since the last signed case and the account's own cost
//     per signed case (ppc_ads_daily + ppc_callrail_daily);
//   - trailing 30 days: wasted Search spend, from the search-terms sync's
//     tables, which that sync keeps complete for exactly that window.

export type AccountHealthRow = {
  id: string;
  name: string;
  triage: Triage;
  snapshotDate: string | null;
  pullErrors: string | null;
  lastSyncFailed: string | null;
  mtdSpend: number;
  dailyBudget: number;
  sharedBudgetCount: number;
  pacing: PacingRead | null;
  budgetLost: number | null;
  rankLost: number | null;
  optimizationScore: number | null;
  conversions: number | null;
  junkConversions: number | null;
  junkShare: number | null;
  junkActions: Array<{ name: string; conversions: number }>;
  // Null = no CallRail company linked.
  signedMtd: number | null;
  lastSignedDate: string | null;
  spendSinceLastSigned: number | null;
  ownCostPerSigned: number | null;
  // Null = not judged (window not fully synced, or no cost per conversion).
  wasted: { dollars: number; terms: number; share: number } | null;
  wastedPartial: boolean;
};

export type AccountHealthOverview = {
  monthStart: string;
  through: string;
  daysElapsed: number;
  portfolio: Portfolio;
  rows: AccountHealthRow[];
};

const micros = (v: bigint | string | number | null | undefined) => Number(v ?? 0) / 1_000_000;
const nullable = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));

export async function getAccountHealthOverview(through: string): Promise<AccountHealthOverview> {
  const w = monthToDateWindow(through);
  const signedFrom = addDays(through, -(TRIAGE.signedLookbackDays - 1));
  const wastedFrom = addDays(through, -(TRIAGE.wastedWindowDays - 1));
  const pacingFrom = addDays(through, -(TRIAGE.pacingWindowDays - 1));

  const [clients, snapshots, signedDays, spendDays, search, deadTerms, jobs] = await Promise.all([
    db.query.ppcClients.findMany({
      where: and(
        eq(ppcClients.isActive, true),
        sql`${ppcClients.googleAdsOauthTokenId} is not null`,
        sql`${ppcClients.googleAdsCustomerId} is not null`,
      ),
      columns: { id: true, name: true, callrailCompanyId: true },
    }),
    // Every snapshot in the pacing window, newest first; the first per
    // client is its latest. Older ones are not shown — a client whose
    // newest snapshot is outside this window has no current data.
    db
      .select()
      .from(ppcAccountHealthDaily)
      .where(and(gte(ppcAccountHealthDaily.date, pacingFrom), lte(ppcAccountHealthDaily.date, through)))
      .orderBy(ppcAccountHealthDaily.ppcClientId, desc(ppcAccountHealthDaily.date)),
    // Days with a signed case (few rows).
    db
      .select({
        ppcClientId: ppcCallrailDaily.ppcClientId,
        date: ppcCallrailDaily.date,
        signedCases: ppcCallrailDaily.signedCases,
      })
      .from(ppcCallrailDaily)
      .where(
        and(
          gte(ppcCallrailDaily.date, signedFrom),
          lte(ppcCallrailDaily.date, through),
          gt(ppcCallrailDaily.signedCases, 0),
        ),
      ),
    // Spend per client per day over the same lookback (all campaign types —
    // the cost signed cases are set against everywhere else in the app).
    db
      .select({
        ppcClientId: ppcAdsDaily.ppcClientId,
        date: ppcAdsDaily.date,
        costMicros: sql<string>`sum(${ppcAdsDaily.costMicros})`,
      })
      .from(ppcAdsDaily)
      .where(and(gte(ppcAdsDaily.date, signedFrom), lte(ppcAdsDaily.date, through)))
      .groupBy(ppcAdsDaily.ppcClientId, ppcAdsDaily.date),
    db
      .select({
        ppcClientId: ppcSearchCampaignsDaily.ppcClientId,
        costMicros: sql<string>`sum(${ppcSearchCampaignsDaily.costMicros})`,
        conversions: sql<string>`sum(${ppcSearchCampaignsDaily.conversions})`,
        syncedDays: sql<string>`count(distinct ${ppcSearchCampaignsDaily.date}) filter (where ${ppcSearchCampaignsDaily.googleAdsCampaignId} = ${SYNC_COVERAGE_CAMPAIGN_ID})`,
      })
      .from(ppcSearchCampaignsDaily)
      .where(and(gte(ppcSearchCampaignsDaily.date, wastedFrom), lte(ppcSearchCampaignsDaily.date, through)))
      .groupBy(ppcSearchCampaignsDaily.ppcClientId),
    // Search terms with spend and no conversion across the whole window.
    db
      .select({
        ppcClientId: ppcSearchTermsDaily.ppcClientId,
        costMicros: sql<string>`sum(${ppcSearchTermsDaily.costMicros})`,
      })
      .from(ppcSearchTermsDaily)
      .where(and(gte(ppcSearchTermsDaily.date, wastedFrom), lte(ppcSearchTermsDaily.date, through)))
      .groupBy(ppcSearchTermsDaily.ppcClientId, ppcSearchTermsDaily.searchTerm)
      .having(sql`sum(${ppcSearchTermsDaily.conversions}) = 0 and sum(${ppcSearchTermsDaily.costMicros}) > 0`),
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

  const group = <T extends { ppcClientId: string | null }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      if (!r.ppcClientId) continue;
      const list = m.get(r.ppcClientId);
      if (list) list.push(r);
      else m.set(r.ppcClientId, [r]);
    }
    return m;
  };
  const snapshotsBy = group(snapshots);
  const signedBy = group(signedDays);
  const spendBy = group(spendDays);
  const deadBy = group(deadTerms);
  const searchBy = new Map(search.map((s) => [s.ppcClientId, s]));
  const jobBy = new Map(jobs.map((j) => [j.ppcClientId, j]));

  // First pass: everything except the triage, which needs the portfolio.
  const drafts = clients.map((c) => {
    const snaps = snapshotsBy.get(c.id) ?? [];
    const s = snaps[0] ?? null;
    const job = jobBy.get(c.id);
    const lastSyncFailed = job?.status === "failed" ? (job.errorMessage ?? "failed") : null;
    // A snapshot from another month describes a different window than the
    // figures beside it, so it is stale however recent.
    const current =
      s !== null && s.monthStart === w.monthStart && daysBetween(s.date, w.through) <= TRIAGE.staleDays;
    const data: TriageInputs["data"] = current ? "ok" : s ? "stale" : lastSyncFailed ? "failed" : "missing";

    const dailyBudget = micros(s?.dailyBudgetMicros);
    const mtdSpend = micros(s?.mtdSpendMicros);
    const conversions = nullable(s?.conversions);
    const junkConversions = nullable(s?.junkConversions);
    const pacing = s
      ? readPacing(
          snaps.map((x) => ({
            date: x.date,
            dailyBudget: micros(x.dailyBudgetMicros),
            spend: x.daySpendMicros === null ? null : micros(x.daySpendMicros),
          })),
          dailyBudget,
        )
      : null;

    // Signed cases: month to date for the column; the lookback for the
    // judgment.
    let signed: TriageInputs["signed"] = null;
    let signedMtd: number | null = null;
    if (c.callrailCompanyId) {
      const days = signedBy.get(c.id) ?? [];
      const spend = spendBy.get(c.id) ?? [];
      signedMtd = days.filter((d) => d.date >= w.monthStart).reduce((n, d) => n + d.signedCases, 0);
      const total = days.reduce((n, d) => n + d.signedCases, 0);
      const lastSignedDate = days.reduce<string | null>((m, d) => (m === null || d.date > m ? d.date : m), null);
      const spendAll = spend.reduce((n, d) => n + micros(d.costMicros), 0);
      const spendSince = spend
        .filter((d) => lastSignedDate === null || d.date > lastSignedDate)
        .reduce((n, d) => n + micros(d.costMicros), 0);
      // Stored spend may start well inside the lookback for a recently
      // added account; the copy then names that date instead of claiming
      // the whole window.
      const firstSpend = spend.reduce<string | null>((m, d) => (m === null || d.date < m ? d.date : m), null);
      const historyFrom =
        firstSpend !== null && daysBetween(signedFrom, firstSpend) > TRIAGE.signedHistorySlack ? firstSpend : null;
      signed = {
        lastSignedDate,
        spendSinceLastSigned: spendSince,
        ownCostPerSigned: total >= TRIAGE.signedOwnMin && spendAll > 0 ? spendAll / total : null,
        historyFrom,
      };
    }

    // Wasted Search spend: terms that individually cost at least the
    // account's own cost per conversion in the window and produced none. A
    // term with a couple of clicks and no conversion is ordinary; one that
    // has outspent a whole conversion without one is not.
    const sr = searchBy.get(c.id);
    const searchSpend = micros(sr?.costMicros);
    const searchConversions = Number(sr?.conversions ?? 0);
    const wastedPartial = Number(sr?.syncedDays ?? 0) < TRIAGE.wastedWindowDays;
    let wasted: TriageInputs["wasted"] = null;
    if (!wastedPartial && searchSpend > 0 && searchConversions > 0) {
      const costPerConversion = searchSpend / searchConversions;
      const over = (deadBy.get(c.id) ?? []).map((t) => micros(t.costMicros)).filter((cost) => cost >= costPerConversion);
      const dollars = over.reduce((n, x) => n + x, 0);
      wasted = { dollars, terms: over.length, share: dollars / searchSpend };
    }

    const inputs: TriageInputs = {
      data,
      mtdSpend,
      conversions,
      junkConversions,
      junkActions: s?.junkActions ?? [],
      pacing,
      signed,
      wasted,
      optimizationScore: nullable(s?.optimizationScore),
      budgetLost: nullable(s?.searchBudgetLostShare),
      rankLost: nullable(s?.searchRankLostShare),
    };
    return { c, s, inputs, lastSyncFailed, dailyBudget, signedMtd, wastedPartial };
  });

  // What is normal across the accounts with current data.
  const live = drafts.filter((d) => d.inputs.data === "ok").map((d) => d.inputs);
  const present = (xs: Array<number | null | undefined>) => xs.filter((x): x is number => typeof x === "number");
  const portfolio: Portfolio = {
    costPerSigned: median(present(live.map((i) => i.signed?.ownCostPerSigned))),
    wastedShareP75: quantile(present(live.map((i) => i.wasted?.share)), 0.75),
    budgetLostMedian: median(present(live.map((i) => i.budgetLost))),
    rankLostMedian: median(present(live.map((i) => i.rankLost))),
  };

  const rows = drafts.map(({ c, s, inputs, lastSyncFailed, dailyBudget, signedMtd, wastedPartial }): AccountHealthRow => ({
    id: c.id,
    name: c.name,
    triage: triage(inputs, portfolio),
    snapshotDate: s?.date ?? null,
    pullErrors: s?.pullErrors ?? null,
    lastSyncFailed,
    mtdSpend: inputs.mtdSpend,
    dailyBudget,
    sharedBudgetCount: s?.sharedBudgetCount ?? 0,
    pacing: inputs.pacing,
    budgetLost: inputs.budgetLost,
    rankLost: inputs.rankLost,
    optimizationScore: inputs.optimizationScore,
    conversions: inputs.conversions,
    junkConversions: inputs.junkConversions,
    junkShare: junkShare(inputs.conversions, inputs.junkConversions),
    junkActions: inputs.junkActions,
    signedMtd,
    lastSignedDate: inputs.signed?.lastSignedDate ?? null,
    spendSinceLastSigned: inputs.signed?.spendSinceLastSigned ?? null,
    ownCostPerSigned: inputs.signed?.ownCostPerSigned ?? null,
    wasted: inputs.wasted,
    wastedPartial,
  }));

  return { ...w, portfolio, rows: rows.sort(compareByTriage) };
}
