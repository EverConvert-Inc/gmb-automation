import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "./db/client";
import { lsaClients, lsaLeadsDaily } from "./db/schema";

export type LsaKpis = {
  phoneCallCount: number;
  messageCount: number;
  bookingCount: number;
  costMicros: bigint;
  signedCases: number;
};

export type LsaClientRow = {
  lsaClientId: string;
  lsaClientName: string;
  phoneCallCount: number;
  messageCount: number;
  bookingCount: number;
  costMicros: bigint;
  signedCases: number;
};

export type LsaByDayPoint = {
  lsaClientId: string;
  lsaClientName: string;
  date: string; // YYYY-MM-DD
  phoneCallCount: number;
};

export type LsaReport = {
  kpis: LsaKpis;
  kpisPrior: LsaKpis;
  rows: LsaClientRow[];
  byDay: LsaByDayPoint[];
};

export type LsaClientListItem = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  googleAdsLinked: boolean;
  googleAdsCustomerId: string | null;
  callrailLinked: boolean;
  callrailCompanyId: string | null;
  signedCaseTag: string;
  lastAdsSyncAt: Date | null;
  lastCallrailSyncAt: Date | null;
  lastSyncError: string | null;
};

export async function listLsaClients(): Promise<LsaClientListItem[]> {
  const rows = await db.query.lsaClients.findMany({
    orderBy: (cols, ops) => ops.asc(cols.name),
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    isActive: r.isActive,
    googleAdsLinked:
      r.googleAdsOauthTokenId !== null && r.googleAdsCustomerId !== null,
    googleAdsCustomerId: r.googleAdsCustomerId,
    callrailLinked: r.callrailCompanyId !== null,
    callrailCompanyId: r.callrailCompanyId,
    signedCaseTag: r.signedCaseTag,
    lastAdsSyncAt: r.lastAdsSyncAt,
    lastCallrailSyncAt: r.lastCallrailSyncAt,
    lastSyncError: r.lastSyncError,
  }));
}

// customerId / companyId → names of OTHER LSA clients already linked.
// Powers the "Already linked to: X" hint in the admin card's comboboxes,
// same as getLinkedAdsCustomerMap/getLinkedCallrailCompanyMap in
// queries.ts for PPC.
export async function getLinkedLsaAdsCustomerMap(
  excludeClientId?: string,
): Promise<Record<string, string[]>> {
  const rows = await db
    .select({
      customerId: lsaClients.googleAdsCustomerId,
      name: lsaClients.name,
      id: lsaClients.id,
    })
    .from(lsaClients)
    .where(sql`${lsaClients.googleAdsCustomerId} is not null`);
  const map: Record<string, string[]> = {};
  for (const r of rows) {
    if (!r.customerId) continue;
    if (excludeClientId && r.id === excludeClientId) continue;
    (map[r.customerId] ??= []).push(r.name);
  }
  return map;
}

export async function getLinkedLsaCallrailCompanyMap(
  excludeClientId?: string,
): Promise<Record<string, string[]>> {
  const rows = await db
    .select({
      companyId: lsaClients.callrailCompanyId,
      name: lsaClients.name,
      id: lsaClients.id,
    })
    .from(lsaClients)
    .where(sql`${lsaClients.callrailCompanyId} is not null`);
  const map: Record<string, string[]> = {};
  for (const r of rows) {
    if (!r.companyId) continue;
    if (excludeClientId && r.id === excludeClientId) continue;
    (map[r.companyId] ??= []).push(r.name);
  }
  return map;
}

async function aggregateLsaKpis(from: string, to: string): Promise<LsaKpis> {
  const [row] = await db
    .select({
      phoneCallCount: sql<number | null>`sum(${lsaLeadsDaily.phoneCallCount})::int`,
      messageCount: sql<number | null>`sum(${lsaLeadsDaily.messageCount})::int`,
      bookingCount: sql<number | null>`sum(${lsaLeadsDaily.bookingCount})::int`,
      costMicros: sql<string | null>`sum(${lsaLeadsDaily.costMicros})`,
      signedCases: sql<number | null>`sum(${lsaLeadsDaily.signedCases})::int`,
    })
    .from(lsaLeadsDaily)
    .where(and(gte(lsaLeadsDaily.date, from), sql`${lsaLeadsDaily.date} <= ${to}`));
  return {
    phoneCallCount: row?.phoneCallCount ?? 0,
    messageCount: row?.messageCount ?? 0,
    bookingCount: row?.bookingCount ?? 0,
    costMicros: row?.costMicros ? BigInt(row.costMicros) : 0n,
    signedCases: row?.signedCases ?? 0,
  };
}

// Unlike getPpcReport (queries.ts), which joins three separate tables
// (ppc_ads_daily / ppc_campaigns / ppc_callrail_daily) and can silently
// drop a client that has CallRail data but no Ads activity in the window,
// lsa_leads_daily is already the single merged fact table (see schema.ts).
// The only join here is to lsa_clients for the display name, and that's
// safe: lsa_leads_daily.lsa_client_id is a NOT NULL FK, so every row here
// is guaranteed to have a matching client — no conditional join-drop risk.
export async function getLsaReport({
  from,
  to,
}: {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}): Promise<LsaReport> {
  // Prior period = immediately-preceding window of the same length, same
  // math as getPpcReport's KPI delta comparison.
  const msPerDay = 86_400_000;
  const fromMs = new Date(from + "T00:00:00Z").getTime();
  const toMs = new Date(to + "T00:00:00Z").getTime();
  const lengthDays = Math.max(0, Math.round((toMs - fromMs) / msPerDay)) + 1;
  const priorFrom = new Date(fromMs - lengthDays * msPerDay)
    .toISOString()
    .slice(0, 10);
  const priorTo = new Date(fromMs - msPerDay).toISOString().slice(0, 10);

  const [kpis, kpisPrior, activeClients, clientRows, byDayRows] = await Promise.all([
    aggregateLsaKpis(from, to),
    aggregateLsaKpis(priorFrom, priorTo),
    // Every active client is seeded into `rows` below with an all-zero row
    // BEFORE the daily data is folded in — a client with zero qualifying
    // leads in range (unsynced, newly added, or genuinely quiet) still
    // shows up instead of silently vanishing from the report, same
    // seed-then-render pattern as getCallQualityByClientReport.
    db
      .select({ id: lsaClients.id, name: lsaClients.name })
      .from(lsaClients)
      .where(eq(lsaClients.isActive, true)),
    db
      .select({
        lsaClientId: lsaClients.id,
        lsaClientName: lsaClients.name,
        phoneCallCount: sql<number | null>`sum(${lsaLeadsDaily.phoneCallCount})::int`,
        messageCount: sql<number | null>`sum(${lsaLeadsDaily.messageCount})::int`,
        bookingCount: sql<number | null>`sum(${lsaLeadsDaily.bookingCount})::int`,
        costMicros: sql<string | null>`sum(${lsaLeadsDaily.costMicros})`,
        signedCases: sql<number | null>`sum(${lsaLeadsDaily.signedCases})::int`,
      })
      .from(lsaLeadsDaily)
      .innerJoin(lsaClients, eq(lsaClients.id, lsaLeadsDaily.lsaClientId))
      .where(and(gte(lsaLeadsDaily.date, from), sql`${lsaLeadsDaily.date} <= ${to}`))
      .groupBy(lsaClients.id, lsaClients.name),
    // Phone calls by day, per client — powers the "Phone calls by day"
    // chart. Same shape as getPpcReport's byDayRows.
    db
      .select({
        lsaClientId: lsaClients.id,
        lsaClientName: lsaClients.name,
        date: lsaLeadsDaily.date,
        phoneCallCount: sql<number | null>`sum(${lsaLeadsDaily.phoneCallCount})::int`,
      })
      .from(lsaLeadsDaily)
      .innerJoin(lsaClients, eq(lsaClients.id, lsaLeadsDaily.lsaClientId))
      .where(and(gte(lsaLeadsDaily.date, from), sql`${lsaLeadsDaily.date} <= ${to}`))
      .groupBy(lsaClients.id, lsaClients.name, lsaLeadsDaily.date)
      .orderBy(lsaLeadsDaily.date),
  ]);

  function emptyLsaRow(id: string, name: string): LsaClientRow {
    return {
      lsaClientId: id,
      lsaClientName: name,
      phoneCallCount: 0,
      messageCount: 0,
      bookingCount: 0,
      costMicros: 0n,
      signedCases: 0,
    };
  }
  const rowMap = new Map<string, LsaClientRow>();
  for (const c of activeClients) rowMap.set(c.id, emptyLsaRow(c.id, c.name));
  for (const r of clientRows) {
    rowMap.set(r.lsaClientId, {
      lsaClientId: r.lsaClientId,
      lsaClientName: r.lsaClientName,
      phoneCallCount: r.phoneCallCount ?? 0,
      messageCount: r.messageCount ?? 0,
      bookingCount: r.bookingCount ?? 0,
      costMicros: r.costMicros ? BigInt(r.costMicros) : 0n,
      signedCases: r.signedCases ?? 0,
    });
  }

  const rows: LsaClientRow[] = Array.from(rowMap.values())
    // Signed cases descending — clients with the most signed cases lead
    // the report. Name is only a tiebreaker for equal (often zero) counts,
    // so ties don't fall back to whatever order Postgres happened to
    // return.
    .sort(
      (a, b) =>
        b.signedCases - a.signedCases ||
        a.lsaClientName.localeCompare(b.lsaClientName),
    );

  const byDay: LsaByDayPoint[] = byDayRows.map((r) => ({
    lsaClientId: r.lsaClientId,
    lsaClientName: r.lsaClientName,
    date: r.date,
    phoneCallCount: r.phoneCallCount ?? 0,
  }));

  return { kpis, kpisPrior, rows, byDay };
}
