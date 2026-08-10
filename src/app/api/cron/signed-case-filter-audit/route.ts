import { NextResponse } from "next/server";
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { lsaClients, lsaLeadsDaily, ppcCallrailDaily, ppcClients } from "@/lib/db/schema";
import { listSignedTaggedCalls, matchesAnyFilter } from "@/lib/callrail";

export const runtime = "nodejs";
export const maxDuration = 300;

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

// Same safe-stringify/describeError pattern as pmax-match-audit/
// text-message-audit/reclassify-call-signed-events.
function safeStringify(value: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === "bigint") return val.toString();
    if (typeof val === "object" && val !== null) {
      if (seen.has(val)) return "[Circular]";
      seen.add(val);
    }
    return val;
  });
}

function describeError(err: unknown): unknown {
  if (err instanceof Error) {
    const extra: Record<string, unknown> = { message: err.message };
    for (const key of Object.getOwnPropertyNames(err)) {
      if (key === "stack" || key === "message") continue;
      extra[key] = (err as unknown as Record<string, unknown>)[key];
    }
    try {
      return JSON.parse(safeStringify(extra));
    } catch {
      return { message: err.message };
    }
  }
  try {
    return JSON.parse(safeStringify(err));
  } catch {
    return { raw: String(err) };
  }
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// Read-only diagnostic — no writes, ever. Confirms/refutes a suspected
// systemic bug: a PPC client's signedCaseNameFilters (see the field
// comment in schema.ts) only counts a Signed-tagged call as a signed
// case if the call's tracking-number name contains one of the
// configured substrings. If an operator narrows those filters to
// something that doesn't actually appear in the client's real CallRail
// tracker names, real signed calls silently stop counting — with no
// error anywhere, since "0 signed cases" looks identical to "no signed
// calls happened."
//
// For every active PPC client with a linked CallRail company, pulls
// every call tagged with that client's signedCaseTag in the lookback
// window, and checks each one's tracker name against
// signedCaseNameFilters using the exact same matchesAnyFilter the real
// report uses. Reports, per client: the configured filters, how many
// tagged calls matched vs. didn't, and the actual unmatched tracker
// names (deduped) so a fix can be written correctly the first time
// instead of guessing.
//
// Also cross-checks a SEPARATE possible cause of the same symptom
// ("/ppc shows fewer signed cases than CallRail's real tag count"):
// staleness. A client whose live matching is provably correct (0
// unmatched calls) can still show a wrong number on /ppc if its
// ppc_callrail_daily rows simply haven't been resynced since the call
// came in — that table is what /ppc actually reads, not a live CallRail
// call. Per day in the window, compares the live, freshly-computed
// signed-case count against what's currently stored, plus the client's
// lastCallrailSyncAt/lastSyncError, so a sync-staleness bug shows up
// distinctly from a filter-matching bug instead of both looking like
// the same "0 signed cases" symptom.
//
// Many of these law-firm CallRail companies have BOTH a ppc_clients row
// and an lsa_clients row (same company, two separate configs — see the
// hasMatchingPpcClient check in lsa-sync.ts). Since the two pipelines
// read the same underlying CallRail calls independently, also surfaces
// each linked LSA client's stored lsa_leads_daily.signedCases in the
// same window, so a call that's missing from ppc_callrail_daily can be
// checked against whether it landed in lsa_leads_daily instead (picked
// up by the other pipeline) or is genuinely absent from both.
//
// Usage:
//   GET /api/cron/signed-case-filter-audit                  (last 90 days, every active client)
//   GET /api/cron/signed-case-filter-audit?days=180
//   GET /api/cron/signed-case-filter-audit?clientId=<uuid>   (single client only)
//
// Delete once the audit is done and any filter fixes are applied.
export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const daysParam = url.searchParams.get("days");
  const days = daysParam ? Number.parseInt(daysParam, 10) : 90;
  if (daysParam && (!Number.isFinite(days) || days <= 0)) {
    return NextResponse.json({ error: "days must be a positive integer" }, { status: 400 });
  }
  const clientId = url.searchParams.get("clientId");

  const fromDate = daysAgoIso(days);
  const toDate = new Date().toISOString().slice(0, 10);

  try {
    const clients = clientId
      ? await db.query.ppcClients.findMany({ where: eq(ppcClients.id, clientId) })
      : await db.query.ppcClients.findMany({ where: eq(ppcClients.isActive, true) });

    const results: Array<{
      clientId: string;
      name: string;
      callrailCompanyId: string | null;
      signedCaseTag: string;
      signedCaseNameFilters: string[];
      lastCallrailSyncAt: string | null;
      lastSyncError: string | null;
      taggedCallCount: number;
      matchedCount: number;
      unmatchedCount: number;
      unmatchedTrackerNames: string[];
      sampleUnmatchedCalls: Array<{
        callId: string;
        date: string;
        trackerName: string;
        sourceNameRaw: string | null;
        formattedTrackingSourceRaw: string | null;
      }>;
      storedSignedCasesTotal: number;
      liveSignedCasesTotal: number;
      stale: boolean;
      staleDates: Array<{ date: string; stored: number; live: number }>;
      linkedLsaClients: Array<{
        lsaClientId: string;
        name: string;
        storedSignedCasesTotal: number;
        nonZeroDates: Array<{ date: string; stored: number }>;
      }>;
      note?: string;
      error?: unknown;
    }> = [];

    // Shared by every branch below — a PPC client's linked LSA sibling(s)
    // don't depend on anything computed from the live CallRail pull, so
    // this is looked up unconditionally (including the "no CallRail
    // company" and "fetch failed" early-return branches) rather than
    // duplicated three times.
    async function findLinkedLsaClients(companyId: string | null) {
      if (!companyId) return [];
      const linked = await db.query.lsaClients.findMany({
        where: eq(lsaClients.callrailCompanyId, companyId),
      });
      return Promise.all(
        linked.map(async (lsa) => {
          const rows = await db.query.lsaLeadsDaily.findMany({
            where: and(
              eq(lsaLeadsDaily.lsaClientId, lsa.id),
              gte(lsaLeadsDaily.date, fromDate),
              lte(lsaLeadsDaily.date, toDate),
            ),
          });
          return {
            lsaClientId: lsa.id,
            name: lsa.name,
            storedSignedCasesTotal: rows.reduce((sum, r) => sum + r.signedCases, 0),
            nonZeroDates: rows
              .filter((r) => r.signedCases > 0)
              .map((r) => ({ date: r.date, stored: r.signedCases }))
              .sort((a, b) => a.date.localeCompare(b.date)),
          };
        }),
      );
    }

    for (const client of clients) {
      if (!client.callrailCompanyId) {
        results.push({
          clientId: client.id,
          name: client.name,
          callrailCompanyId: null,
          signedCaseTag: client.signedCaseTag,
          signedCaseNameFilters: client.signedCaseNameFilters,
          lastCallrailSyncAt: client.lastCallrailSyncAt?.toISOString() ?? null,
          lastSyncError: client.lastSyncError,
          taggedCallCount: 0,
          matchedCount: 0,
          unmatchedCount: 0,
          unmatchedTrackerNames: [],
          sampleUnmatchedCalls: [],
          storedSignedCasesTotal: 0,
          liveSignedCasesTotal: 0,
          stale: false,
          staleDates: [],
          linkedLsaClients: await findLinkedLsaClients(null),
          note: "No CallRail company linked — skipped",
        });
        continue;
      }

      const filtersLower = client.signedCaseNameFilters
        .map((f) => f.trim().toLowerCase())
        .filter(Boolean);

      let tagged;
      try {
        tagged = await listSignedTaggedCalls(
          client.callrailCompanyId,
          fromDate,
          toDate,
          client.signedCaseTag,
        );
      } catch (err) {
        results.push({
          clientId: client.id,
          name: client.name,
          callrailCompanyId: client.callrailCompanyId,
          signedCaseTag: client.signedCaseTag,
          signedCaseNameFilters: client.signedCaseNameFilters,
          lastCallrailSyncAt: client.lastCallrailSyncAt?.toISOString() ?? null,
          lastSyncError: client.lastSyncError,
          taggedCallCount: 0,
          matchedCount: 0,
          unmatchedCount: 0,
          unmatchedTrackerNames: [],
          sampleUnmatchedCalls: [],
          storedSignedCasesTotal: 0,
          liveSignedCasesTotal: 0,
          stale: false,
          staleDates: [],
          linkedLsaClients: await findLinkedLsaClients(client.callrailCompanyId),
          error: describeError(err),
        });
        continue;
      }

      const unmatchedCalls = tagged.filter(
        (c) => filtersLower.length > 0 && !matchesAnyFilter(c.trackerName, filtersLower),
      );
      const unmatchedTrackerNames = [...new Set(unmatchedCalls.map((c) => c.trackerName))];

      // Live, per-day signed-case count using the exact same gate
      // pullCallsForCompany applies — empty filter list means "no
      // restriction" (see matchesAnyFilter's caller in callrail.ts).
      const liveByDate = new Map<string, number>();
      for (const c of tagged) {
        const matched = filtersLower.length === 0 || matchesAnyFilter(c.trackerName, filtersLower);
        if (matched) liveByDate.set(c.date, (liveByDate.get(c.date) ?? 0) + 1);
      }

      const storedRows = await db.query.ppcCallrailDaily.findMany({
        where: and(
          eq(ppcCallrailDaily.ppcClientId, client.id),
          gte(ppcCallrailDaily.date, fromDate),
          lte(ppcCallrailDaily.date, toDate),
        ),
      });
      const storedByDate = new Map(storedRows.map((r) => [r.date, r.signedCases]));

      const allDates = new Set([...liveByDate.keys(), ...storedByDate.keys()]);
      const staleDates: Array<{ date: string; stored: number; live: number }> = [];
      for (const date of allDates) {
        const stored = storedByDate.get(date) ?? 0;
        const live = liveByDate.get(date) ?? 0;
        if (stored !== live) staleDates.push({ date, stored, live });
      }
      staleDates.sort((a, b) => a.date.localeCompare(b.date));

      const storedSignedCasesTotal = storedRows.reduce((sum, r) => sum + r.signedCases, 0);
      const liveSignedCasesTotal = [...liveByDate.values()].reduce((sum, n) => sum + n, 0);

      results.push({
        clientId: client.id,
        name: client.name,
        callrailCompanyId: client.callrailCompanyId,
        signedCaseTag: client.signedCaseTag,
        signedCaseNameFilters: client.signedCaseNameFilters,
        lastCallrailSyncAt: client.lastCallrailSyncAt?.toISOString() ?? null,
        lastSyncError: client.lastSyncError,
        taggedCallCount: tagged.length,
        matchedCount: tagged.length - unmatchedCalls.length,
        unmatchedCount: unmatchedCalls.length,
        unmatchedTrackerNames,
        sampleUnmatchedCalls: unmatchedCalls.slice(0, 10),
        storedSignedCasesTotal,
        liveSignedCasesTotal,
        stale: staleDates.length > 0,
        staleDates,
        linkedLsaClients: await findLinkedLsaClients(client.callrailCompanyId),
      });
    }

    const clientsWithMismatches = results.filter((r) => r.unmatchedCount > 0);
    const clientsWithStaleData = results.filter((r) => r.stale);

    return NextResponse.json({
      window: { fromDate, toDate, days },
      clientsChecked: results.length,
      clientsWithMismatches: clientsWithMismatches.length,
      mismatchClientNames: clientsWithMismatches.map((r) => r.name),
      clientsWithStaleData: clientsWithStaleData.length,
      staleClientNames: clientsWithStaleData.map((r) => r.name),
      results,
    });
  } catch (err) {
    return NextResponse.json({ error: describeError(err) }, { status: 500 });
  }
}
