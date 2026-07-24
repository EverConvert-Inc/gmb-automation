import { and, gte, sql } from "drizzle-orm";
import { db } from "./db/client";
import {
  lsaCallrailTagCategories,
  lsaLeadsDaily,
  ppcAdsDaily,
  ppcCallrailDaily,
  ppcCallrailTagCategories,
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

function addTagCount(
  acc: Accumulator,
  label: string,
  count: number,
  rollup: "real" | "junk" | "unclassified",
) {
  acc.tagCounts[label] = (acc.tagCounts[label] ?? 0) + count;
  acc[rollup] += count;
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
          ppcClientId: ppcCallrailTagCategories.ppcClientId,
          label: ppcCallrailTagCategories.label,
          rollup: ppcCallrailTagCategories.rollup,
          sortOrder: ppcCallrailTagCategories.sortOrder,
        })
        .from(ppcCallrailTagCategories),
      db
        .select({
          lsaClientId: lsaLeadsDaily.lsaClientId,
          date: lsaLeadsDaily.date,
          tagCategoryBreakdown: lsaLeadsDaily.tagCategoryBreakdown,
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
          lsaClientId: lsaCallrailTagCategories.lsaClientId,
          label: lsaCallrailTagCategories.label,
          rollup: lsaCallrailTagCategories.rollup,
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

  const ppcRollupMap = new Map<string, "real" | "junk">();
  for (const c of ppcTagCategoryRows) {
    ppcRollupMap.set(`${c.ppcClientId}::${c.label}`, c.rollup as "real" | "junk");
  }
  const lsaRollupMap = new Map<string, "real" | "junk">();
  for (const c of lsaTagCategoryRows) {
    lsaRollupMap.set(`${c.lsaClientId}::${c.label}`, c.rollup as "real" | "junk");
  }

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

  // PPC + GMB, from ppc_callrail_daily's channel-nested breakdown.
  for (const row of ppcDailyRows) {
    const period = periodKey(row.date, granularity);
    const breakdown = (row.tagCategoryBreakdown ?? {}) as Record<
      string,
      { totalCalls?: number; firstTimeCalls?: number; tagCategoryBreakdown?: Record<string, number> }
    >;
    for (const channel of ["PPC", "GMB"] as const) {
      const chData = breakdown[channel];
      if (!chData) continue;
      const periodAcc = getPeriodAcc(period, channel);
      const summaryAcc = summaryAccs[channel];
      periodAcc.firstTimeCalls += chData.firstTimeCalls ?? 0;
      summaryAcc.firstTimeCalls += chData.firstTimeCalls ?? 0;
      for (const [label, count] of Object.entries(chData.tagCategoryBreakdown ?? {})) {
        const rollup = ppcRollupMap.get(`${row.ppcClientId}::${label}`) ?? "unclassified";
        addTagCount(periodAcc, label, count, rollup);
        addTagCount(summaryAcc, label, count, rollup);
      }
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

  // LSA — flat breakdown, own cost + chargedCount already merged onto
  // lsa_leads_daily by lsa-sync.ts.
  for (const row of lsaDailyRows) {
    const period = periodKey(row.date, granularity);
    const periodAcc = getPeriodAcc(period, "LSA");
    const summaryAcc = summaryAccs.LSA;
    periodAcc.firstTimeCalls += row.firstTimeCalls;
    summaryAcc.firstTimeCalls += row.firstTimeCalls;
    periodAcc.costMicros += row.costMicros;
    summaryAcc.costMicros += row.costMicros;
    periodAcc.chargedCount += row.chargedCount;
    summaryAcc.chargedCount += row.chargedCount;
    for (const [label, count] of Object.entries(
      (row.tagCategoryBreakdown ?? {}) as Record<string, number>,
    )) {
      const rollup = lsaRollupMap.get(`${row.lsaClientId}::${label}`) ?? "unclassified";
      addTagCount(periodAcc, label, count, rollup);
      addTagCount(summaryAcc, label, count, rollup);
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
