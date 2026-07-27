import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "./db/client";
import {
  lsaCallrailTagCategories,
  lsaClients,
  lsaLeadsDaily,
  ppcAdsDaily,
  ppcCallrailDaily,
  ppcCallrailTagCategories,
  ppcClients,
} from "./db/schema";

export type CallQualityChannel = "PPC" | "LSA" | "GMB";
export type CallQualityGranularity = "day" | "week";

type Accumulator = {
  firstTimeCalls: number;
  tagCounts: Record<string, number>;
  real: number;
  junk: number;
  unclassified: number;
  costMicros: bigint;
  // Denominators for "Ads-reported CPA" — a different metric from our own
  // tag-based "real cost per real lead". PPC uses Google Ads' own
  // conversions; LSA uses lead_charged (the closest LSA analog to a
  // Google-reported conversion, since local_services_lead has no
  // `conversions` metric). Unused for GMB — no Google Ads campaign
  // backs it.
  conversions: number;
  chargedCount: number;
};

function emptyAcc(): Accumulator {
  return {
    firstTimeCalls: 0,
    tagCounts: {},
    real: 0,
    junk: 0,
    unclassified: 0,
    costMicros: 0n,
    conversions: 0,
    chargedCount: 0,
  };
}

// Per-label counts only — no rollup here. A call can carry multiple
// matching tags, so these counts double-count a call across labels by
// design (each category column should independently reflect "calls
// carrying this tag"). Rollup totals are added separately via
// addRollupCounts, sourced from the pre-deduped rollup_breakdown column
// computed at sync time (see callrail.ts's CallrailRollupCounts) — never
// derived from these per-label counts, which is what caused a call with
// 2+ same-rollup tags to be counted twice in Real/Junk.
function addLabelCounts(
  acc: Accumulator,
  label: string,
  count: number,
) {
  acc.tagCounts[label] = (acc.tagCounts[label] ?? 0) + count;
}

function addRollupCounts(
  acc: Accumulator,
  counts: { real?: number; junk?: number; unclassified?: number } | undefined,
) {
  acc.real += counts?.real ?? 0;
  acc.junk += counts?.junk ?? 0;
  acc.unclassified += counts?.unclassified ?? 0;
}

type FlatRollup = { real?: number; junk?: number; unclassified?: number };
type FlatTagBreakdown = Record<string, number>;

type LsaChannelData = {
  tagCategoryBreakdown: FlatTagBreakdown;
  rollupBreakdown: FlatRollup;
  firstTimeCalls: number;
};

// lsa_leads_daily.tagCategoryBreakdown/rollupBreakdown/firstTimeCalls are
// flat (today's shape, and forever for any LSA client whose CallRail
// company has a matching ppc_clients row — GMB stays owned by that side)
// OR channel-nested like ppc_callrail_daily's (keyed "LSA"/"GMB", for
// LSA-only clients with gmbCallrailNameFilters configured — see
// lsa-sync.ts). Detected by value type, not key names: a nested
// rollupBreakdown's values are objects, a flat one's are numbers (and a
// flat firstTimeCalls is a bare JSON number rather than an object at all).
// Historical rows written before GMB splitting existed for that client are
// flat and get read as "all LSA" until resynced — same zero-dip tradeoff
// already accepted for the original rollup_breakdown backfill.
function normalizeLsaBreakdown(
  tagCategoryBreakdown: unknown,
  rollupBreakdown: unknown,
  firstTimeCalls: unknown,
): Record<string, LsaChannelData> {
  const rollupObj = (rollupBreakdown ?? {}) as Record<string, unknown>;
  const tagObj = (tagCategoryBreakdown ?? {}) as Record<string, unknown>;
  const firstRollupValue = Object.values(rollupObj)[0];
  const isNested = typeof firstRollupValue === "object" && firstRollupValue !== null;

  if (!isNested) {
    return {
      LSA: {
        tagCategoryBreakdown: tagObj as FlatTagBreakdown,
        rollupBreakdown: rollupObj as FlatRollup,
        firstTimeCalls: (firstTimeCalls as number | null) ?? 0,
      },
    };
  }

  const ftcObj = (firstTimeCalls ?? {}) as Record<string, number>;
  const channels = new Set([
    ...Object.keys(tagObj),
    ...Object.keys(rollupObj),
    ...Object.keys(ftcObj),
  ]);
  const result: Record<string, LsaChannelData> = {};
  for (const channel of channels) {
    result[channel] = {
      tagCategoryBreakdown: (tagObj[channel] ?? {}) as FlatTagBreakdown,
      rollupBreakdown: (rollupObj[channel] ?? {}) as FlatRollup,
      firstTimeCalls: ftcObj[channel] ?? 0,
    };
  }
  return result;
}

export type CallQualityChannelTotals = {
  channel: CallQualityChannel;
  firstTimeCalls: number;
  tagCounts: Record<string, number>;
  real: number;
  junk: number;
  unclassified: number;
  costMicros: bigint;
  // Both in dollars. null when the denominator is zero, or (GMB) when the
  // metric doesn't apply at all — GMB carries no ad spend, so neither
  // figure is meaningful there.
  realCostPerRealLead: number | null;
  adsReportedCpa: number | null;
};

export type CallQualityPeriodRow = CallQualityChannelTotals & {
  period: string; // YYYY-MM-DD; Monday-of-week when granularity is "week"
};

export type CallQualityReport = {
  granularity: CallQualityGranularity;
  rows: CallQualityPeriodRow[]; // sorted by period asc, then channel
  // Union of every tag category label seen in the range, ordered by the
  // lowest sortOrder configured for that label across any client (falls
  // back to alphabetical, then to the end for labels no longer in any
  // client's current config — e.g. renamed/removed since the data synced).
  allLabels: string[];
  summary: Record<CallQualityChannel, CallQualityChannelTotals>;
};

function finalize(
  channel: CallQualityChannel,
  acc: Accumulator,
): CallQualityChannelTotals {
  const realCostPerRealLead =
    channel === "GMB"
      ? null
      : acc.real > 0
        ? Number(acc.costMicros) / 1_000_000 / acc.real
        : null;
  const adsReportedCpa =
    channel === "GMB"
      ? null
      : channel === "PPC"
        ? acc.conversions > 0
          ? Number(acc.costMicros) / 1_000_000 / acc.conversions
          : null
        : acc.chargedCount > 0
          ? Number(acc.costMicros) / 1_000_000 / acc.chargedCount
          : null;
  return {
    channel,
    firstTimeCalls: acc.firstTimeCalls,
    tagCounts: acc.tagCounts,
    real: acc.real,
    junk: acc.junk,
    unclassified: acc.unclassified,
    costMicros: acc.costMicros,
    realCostPerRealLead,
    adsReportedCpa,
  };
}

// Monday of the ISO week containing dateStr (YYYY-MM-DD, UTC).
function mondayOfIsoWeek(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return d.toISOString().slice(0, 10);
}

function periodKey(dateStr: string, granularity: CallQualityGranularity): string {
  return granularity === "week" ? mondayOfIsoWeek(dateStr) : dateStr;
}

// Cross-channel (PPC, LSA, GMB) call-quality report, aggregated across
// every client — no per-client breakdown (can be added later if needed).
// Organic isn't tracked as a channel yet.
export async function getCallQualityReport({
  from,
  to,
  granularity,
}: {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  granularity: CallQualityGranularity;
}): Promise<CallQualityReport> {
  const [ppcDailyRows, ppcTagCategoryRows, lsaDailyRows, lsaTagCategoryRows, ppcAdsRows] =
    await Promise.all([
      db
        .select({
          ppcClientId: ppcCallrailDaily.ppcClientId,
          date: ppcCallrailDaily.date,
          tagCategoryBreakdown: ppcCallrailDaily.tagCategoryBreakdown,
          rollupBreakdown: ppcCallrailDaily.rollupBreakdown,
        })
        .from(ppcCallrailDaily)
        .where(
          and(
            gte(ppcCallrailDaily.date, from),
            sql`${ppcCallrailDaily.date} <= ${to}`,
          ),
        ),
      // Only used for allLabels' column ordering (sortOrder) — rollup
      // totals now come from rollup_breakdown, computed at sync time.
      db
        .select({
          label: ppcCallrailTagCategories.label,
          sortOrder: ppcCallrailTagCategories.sortOrder,
        })
        .from(ppcCallrailTagCategories),
      db
        .select({
          lsaClientId: lsaLeadsDaily.lsaClientId,
          date: lsaLeadsDaily.date,
          tagCategoryBreakdown: lsaLeadsDaily.tagCategoryBreakdown,
          rollupBreakdown: lsaLeadsDaily.rollupBreakdown,
          costMicros: lsaLeadsDaily.costMicros,
          chargedCount: lsaLeadsDaily.chargedCount,
          firstTimeCalls: lsaLeadsDaily.firstTimeCalls,
        })
        .from(lsaLeadsDaily)
        .where(
          and(
            gte(lsaLeadsDaily.date, from),
            sql`${lsaLeadsDaily.date} <= ${to}`,
          ),
        ),
      db
        .select({
          label: lsaCallrailTagCategories.label,
          sortOrder: lsaCallrailTagCategories.sortOrder,
        })
        .from(lsaCallrailTagCategories),
      // PPC's Google Ads cost/conversions aren't split by channel — GMB
      // never gets a cost figure (confirmed: organic, no ad spend), so
      // all of it belongs to the PPC channel. Summed at the DB level
      // since we don't need per-client/per-campaign detail here.
      db
        .select({
          date: ppcAdsDaily.date,
          costMicros: sql<string>`sum(${ppcAdsDaily.costMicros})`,
          conversions: sql<string>`sum(${ppcAdsDaily.conversions})`,
        })
        .from(ppcAdsDaily)
        .where(
          and(
            gte(ppcAdsDaily.date, from),
            sql`${ppcAdsDaily.date} <= ${to}`,
          ),
        )
        .groupBy(ppcAdsDaily.date),
    ]);

  // Lowest sortOrder configured for a given label, across every client on
  // either side — just for stable column ordering in the report.
  const labelSortOrder = new Map<string, number>();
  for (const c of [...ppcTagCategoryRows, ...lsaTagCategoryRows]) {
    const existing = labelSortOrder.get(c.label);
    if (existing === undefined || c.sortOrder < existing) {
      labelSortOrder.set(c.label, c.sortOrder);
    }
  }

  const periodAccs = new Map<string, Accumulator>(); // key: `${period}::${channel}`
  const summaryAccs: Record<CallQualityChannel, Accumulator> = {
    PPC: emptyAcc(),
    LSA: emptyAcc(),
    GMB: emptyAcc(),
  };

  function getPeriodAcc(period: string, channel: CallQualityChannel): Accumulator {
    const key = `${period}::${channel}`;
    let acc = periodAccs.get(key);
    if (!acc) {
      acc = emptyAcc();
      periodAccs.set(key, acc);
    }
    return acc;
  }

  // PPC + GMB, from ppc_callrail_daily's channel-nested breakdowns.
  // tagCategoryBreakdown (per-label, may double-count a call across
  // labels) and rollupBreakdown (per-call, pre-deduped at sync time) are
  // read independently — rollup totals never derive from label counts.
  for (const row of ppcDailyRows) {
    const period = periodKey(row.date, granularity);
    const breakdown = (row.tagCategoryBreakdown ?? {}) as Record<
      string,
      { totalCalls?: number; firstTimeCalls?: number; tagCategoryBreakdown?: Record<string, number> }
    >;
    const rollupBreakdown = (row.rollupBreakdown ?? {}) as Record<
      string,
      { real?: number; junk?: number; unclassified?: number }
    >;
    for (const channel of ["PPC", "GMB"] as const) {
      const chData = breakdown[channel];
      if (!chData) continue; // no calls classified to this channel that day
      const periodAcc = getPeriodAcc(period, channel);
      const summaryAcc = summaryAccs[channel];
      periodAcc.firstTimeCalls += chData.firstTimeCalls ?? 0;
      summaryAcc.firstTimeCalls += chData.firstTimeCalls ?? 0;
      for (const [label, count] of Object.entries(chData.tagCategoryBreakdown ?? {})) {
        addLabelCounts(periodAcc, label, count);
        addLabelCounts(summaryAcc, label, count);
      }
      addRollupCounts(periodAcc, rollupBreakdown[channel]);
      addRollupCounts(summaryAcc, rollupBreakdown[channel]);
    }
  }

  // PPC cost + Ads-reported conversions (channel PPC only).
  for (const row of ppcAdsRows) {
    const period = periodKey(row.date, granularity);
    const periodAcc = getPeriodAcc(period, "PPC");
    const summaryAcc = summaryAccs.PPC;
    const costMicros = BigInt(row.costMicros ?? "0");
    const conversions = Number(row.conversions ?? 0);
    periodAcc.costMicros += costMicros;
    periodAcc.conversions += conversions;
    summaryAcc.costMicros += costMicros;
    summaryAcc.conversions += conversions;
  }

  // LSA — cost/chargedCount are blended totals (not split by channel — see
  // lsa-sync.ts) and always attributed to the LSA report channel in full,
  // even for a client whose tag/rollup/firstTimeCalls breakdown below does
  // carve out a GMB share. tagCategoryBreakdown/rollupBreakdown/
  // firstTimeCalls are normalized since they can be flat or channel-nested
  // (see normalizeLsaBreakdown) — "LSA" is always present; "GMB" only
  // appears for a client with no matching PPC record.
  for (const row of lsaDailyRows) {
    const period = periodKey(row.date, granularity);
    const periodAcc = getPeriodAcc(period, "LSA");
    const summaryAcc = summaryAccs.LSA;
    periodAcc.costMicros += row.costMicros;
    summaryAcc.costMicros += row.costMicros;
    periodAcc.chargedCount += row.chargedCount;
    summaryAcc.chargedCount += row.chargedCount;

    const byChannel = normalizeLsaBreakdown(
      row.tagCategoryBreakdown,
      row.rollupBreakdown,
      row.firstTimeCalls,
    );
    for (const [channel, data] of Object.entries(byChannel)) {
      const reportChannel = channel as CallQualityChannel;
      const chPeriodAcc = reportChannel === "LSA" ? periodAcc : getPeriodAcc(period, reportChannel);
      const chSummaryAcc = reportChannel === "LSA" ? summaryAcc : summaryAccs[reportChannel];
      chPeriodAcc.firstTimeCalls += data.firstTimeCalls;
      chSummaryAcc.firstTimeCalls += data.firstTimeCalls;
      for (const [label, count] of Object.entries(data.tagCategoryBreakdown)) {
        addLabelCounts(chPeriodAcc, label, count);
        addLabelCounts(chSummaryAcc, label, count);
      }
      addRollupCounts(chPeriodAcc, data.rollupBreakdown);
      addRollupCounts(chSummaryAcc, data.rollupBreakdown);
    }
  }

  const rows: CallQualityPeriodRow[] = Array.from(periodAccs.entries())
    .map(([key, acc]) => {
      const sep = key.lastIndexOf("::");
      const period = key.slice(0, sep);
      const channel = key.slice(sep + 2) as CallQualityChannel;
      return { period, ...finalize(channel, acc) };
    })
    .sort((a, b) => a.period.localeCompare(b.period) || a.channel.localeCompare(b.channel));

  const allLabelsSet = new Set<string>();
  for (const acc of Object.values(summaryAccs)) {
    for (const label of Object.keys(acc.tagCounts)) allLabelsSet.add(label);
  }
  const allLabels = Array.from(allLabelsSet).sort((a, b) => {
    const oa = labelSortOrder.get(a) ?? Number.POSITIVE_INFINITY;
    const ob = labelSortOrder.get(b) ?? Number.POSITIVE_INFINITY;
    return oa - ob || a.localeCompare(b);
  });

  const summary: Record<CallQualityChannel, CallQualityChannelTotals> = {
    PPC: finalize("PPC", summaryAccs.PPC),
    LSA: finalize("LSA", summaryAccs.LSA),
    GMB: finalize("GMB", summaryAccs.GMB),
  };

  return { granularity, rows, allLabels, summary };
}

export type CallQualityClientRow = CallQualityChannelTotals & {
  clientId: string;
  clientName: string;
};

export type CallQualityByClientReport = {
  // GMB rows are keyed by whichever client actually owns GMB
  // classification for that CallRail company — the ppc_clients roster for
  // the common case (a shared company), or the lsa_clients roster for an
  // LSA-only client with its own gmbCallrailNameFilters configured (see
  // lsa-sync.ts). Never both for the same company — that would
  // double-count the same calls under two channel rows.
  clients: Record<CallQualityChannel, CallQualityClientRow[]>;
  summary: Record<CallQualityChannel, CallQualityChannelTotals>;
};

// Per-client version of getCallQualityReport, aggregated over the whole
// [from, to] range instead of broken out by day/week. Every active client
// with a CallRail company linked appears (zero-filled if it had no
// qualifying calls in range) — a client with unconfigured
// signedCaseNameFilters/gmbCallrailNameFilters now correctly shows all
// zeros rather than silently vanishing, which is useful for spotting a
// misconfigured client.
export async function getCallQualityByClientReport({
  from,
  to,
}: {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}): Promise<CallQualityByClientReport> {
  const [
    ppcClientRows,
    lsaClientRows,
    ppcDailyRows,
    lsaDailyRows,
    ppcAdsRows,
  ] = await Promise.all([
    db
      .select({ id: ppcClients.id, name: ppcClients.name })
      .from(ppcClients)
      .where(
        and(
          eq(ppcClients.isActive, true),
          sql`${ppcClients.callrailCompanyId} is not null`,
        ),
      ),
    db
      .select({ id: lsaClients.id, name: lsaClients.name })
      .from(lsaClients)
      .where(
        and(
          eq(lsaClients.isActive, true),
          sql`${lsaClients.callrailCompanyId} is not null`,
        ),
      ),
    db
      .select({
        ppcClientId: ppcCallrailDaily.ppcClientId,
        tagCategoryBreakdown: ppcCallrailDaily.tagCategoryBreakdown,
        rollupBreakdown: ppcCallrailDaily.rollupBreakdown,
      })
      .from(ppcCallrailDaily)
      .where(
        and(
          gte(ppcCallrailDaily.date, from),
          sql`${ppcCallrailDaily.date} <= ${to}`,
        ),
      ),
    db
      .select({
        lsaClientId: lsaLeadsDaily.lsaClientId,
        tagCategoryBreakdown: lsaLeadsDaily.tagCategoryBreakdown,
        rollupBreakdown: lsaLeadsDaily.rollupBreakdown,
        costMicros: lsaLeadsDaily.costMicros,
        chargedCount: lsaLeadsDaily.chargedCount,
        firstTimeCalls: lsaLeadsDaily.firstTimeCalls,
      })
      .from(lsaLeadsDaily)
      .where(
        and(
          gte(lsaLeadsDaily.date, from),
          sql`${lsaLeadsDaily.date} <= ${to}`,
        ),
      ),
    // Summed per PPC client directly at the DB level — no day/week
    // granularity needed here, just the range total.
    db
      .select({
        ppcClientId: ppcAdsDaily.ppcClientId,
        costMicros: sql<string>`sum(${ppcAdsDaily.costMicros})`,
        conversions: sql<string>`sum(${ppcAdsDaily.conversions})`,
      })
      .from(ppcAdsDaily)
      .where(
        and(
          gte(ppcAdsDaily.date, from),
          sql`${ppcAdsDaily.date} <= ${to}`,
        ),
      )
      .groupBy(ppcAdsDaily.ppcClientId),
  ]);

  const nameById = new Map<string, string>();
  for (const c of ppcClientRows) nameById.set(c.id, c.name);
  for (const c of lsaClientRows) nameById.set(c.id, c.name);

  const clientAccs: Record<CallQualityChannel, Map<string, Accumulator>> = {
    PPC: new Map(),
    LSA: new Map(),
    GMB: new Map(),
  };
  const summaryAccs: Record<CallQualityChannel, Accumulator> = {
    PPC: emptyAcc(),
    LSA: emptyAcc(),
    GMB: emptyAcc(),
  };

  function getClientAcc(channel: CallQualityChannel, clientId: string): Accumulator {
    const map = clientAccs[channel];
    let acc = map.get(clientId);
    if (!acc) {
      acc = emptyAcc();
      map.set(clientId, acc);
    }
    return acc;
  }

  // Seed every linked, active client with a zero-filled row up front, so
  // one with no qualifying calls in range still shows up instead of
  // silently vanishing.
  for (const c of ppcClientRows) {
    getClientAcc("PPC", c.id);
    getClientAcc("GMB", c.id);
  }
  for (const c of lsaClientRows) {
    getClientAcc("LSA", c.id);
  }

  for (const row of ppcDailyRows) {
    const breakdown = (row.tagCategoryBreakdown ?? {}) as Record<
      string,
      { totalCalls?: number; firstTimeCalls?: number; tagCategoryBreakdown?: Record<string, number> }
    >;
    const rollupBreakdown = (row.rollupBreakdown ?? {}) as Record<
      string,
      { real?: number; junk?: number; unclassified?: number }
    >;
    for (const channel of ["PPC", "GMB"] as const) {
      const chData = breakdown[channel];
      if (!chData) continue;
      // Client since deactivated or unlinked from CallRail — its historical
      // daily rows are still in range, but it's no longer in the seeded
      // (active + linked) set, so it shouldn't surface as a stray
      // "(unknown)" row. Exclude from both the per-client and summary
      // totals rather than reintroducing a name lookup for it.
      if (!clientAccs[channel].has(row.ppcClientId)) continue;
      const clientAcc = getClientAcc(channel, row.ppcClientId);
      const summaryAcc = summaryAccs[channel];
      clientAcc.firstTimeCalls += chData.firstTimeCalls ?? 0;
      summaryAcc.firstTimeCalls += chData.firstTimeCalls ?? 0;
      for (const [label, count] of Object.entries(chData.tagCategoryBreakdown ?? {})) {
        addLabelCounts(clientAcc, label, count);
        addLabelCounts(summaryAcc, label, count);
      }
      addRollupCounts(clientAcc, rollupBreakdown[channel]);
      addRollupCounts(summaryAcc, rollupBreakdown[channel]);
    }
  }

  for (const row of ppcAdsRows) {
    // Same exclusion as above — Google Ads cost/conversions for a client
    // no longer active/linked shouldn't surface here either.
    if (!clientAccs.PPC.has(row.ppcClientId)) continue;
    const clientAcc = getClientAcc("PPC", row.ppcClientId);
    const summaryAcc = summaryAccs.PPC;
    const costMicros = BigInt(row.costMicros ?? "0");
    const conversions = Number(row.conversions ?? 0);
    clientAcc.costMicros += costMicros;
    clientAcc.conversions += conversions;
    summaryAcc.costMicros += costMicros;
    summaryAcc.conversions += conversions;
  }

  for (const row of lsaDailyRows) {
    // Same exclusion as above — client since deactivated or unlinked from
    // CallRail. Checked against the LSA roster regardless of which report
    // channel this row's data ends up in below (a GMB row for this client
    // has nothing else to be seeded against).
    if (!clientAccs.LSA.has(row.lsaClientId)) continue;
    const clientAcc = getClientAcc("LSA", row.lsaClientId);
    const summaryAcc = summaryAccs.LSA;
    clientAcc.costMicros += row.costMicros;
    summaryAcc.costMicros += row.costMicros;
    clientAcc.chargedCount += row.chargedCount;
    summaryAcc.chargedCount += row.chargedCount;

    // tagCategoryBreakdown/rollupBreakdown/firstTimeCalls are normalized
    // since they can be flat or channel-nested (see normalizeLsaBreakdown)
    // — "LSA" is always present; "GMB" only appears for a client with no
    // matching PPC record, in which case this is that client's only route
    // into the report's GMB channel (getClientAcc lazily creates its row
    // here — GMB isn't pre-seeded from the LSA roster the way PPC's GMB
    // rows are, since a shared-company LSA client must never get one).
    const byChannel = normalizeLsaBreakdown(
      row.tagCategoryBreakdown,
      row.rollupBreakdown,
      row.firstTimeCalls,
    );
    for (const [channel, data] of Object.entries(byChannel)) {
      const reportChannel = channel as CallQualityChannel;
      const chClientAcc =
        reportChannel === "LSA" ? clientAcc : getClientAcc(reportChannel, row.lsaClientId);
      const chSummaryAcc = reportChannel === "LSA" ? summaryAcc : summaryAccs[reportChannel];
      chClientAcc.firstTimeCalls += data.firstTimeCalls;
      chSummaryAcc.firstTimeCalls += data.firstTimeCalls;
      for (const [label, count] of Object.entries(data.tagCategoryBreakdown)) {
        addLabelCounts(chClientAcc, label, count);
        addLabelCounts(chSummaryAcc, label, count);
      }
      addRollupCounts(chClientAcc, data.rollupBreakdown);
      addRollupCounts(chSummaryAcc, data.rollupBreakdown);
    }
  }

  function buildClientRows(channel: CallQualityChannel): CallQualityClientRow[] {
    return Array.from(clientAccs[channel].entries())
      .map(([clientId, acc]) => ({
        clientId,
        clientName: nameById.get(clientId) ?? "(unknown)",
        ...finalize(channel, acc),
      }))
      .sort((a, b) => b.real - a.real || a.clientName.localeCompare(b.clientName));
  }

  const clients: Record<CallQualityChannel, CallQualityClientRow[]> = {
    PPC: buildClientRows("PPC"),
    LSA: buildClientRows("LSA"),
    GMB: buildClientRows("GMB"),
  };

  const summary: Record<CallQualityChannel, CallQualityChannelTotals> = {
    PPC: finalize("PPC", summaryAccs.PPC),
    LSA: finalize("LSA", summaryAccs.LSA),
    GMB: finalize("GMB", summaryAccs.GMB),
  };

  return { clients, summary };
}
