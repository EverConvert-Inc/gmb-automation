import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ppcClients } from "@/lib/db/schema";
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
      note?: string;
      error?: unknown;
    }> = [];

    for (const client of clients) {
      if (!client.callrailCompanyId) {
        results.push({
          clientId: client.id,
          name: client.name,
          callrailCompanyId: null,
          signedCaseTag: client.signedCaseTag,
          signedCaseNameFilters: client.signedCaseNameFilters,
          taggedCallCount: 0,
          matchedCount: 0,
          unmatchedCount: 0,
          unmatchedTrackerNames: [],
          sampleUnmatchedCalls: [],
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
          taggedCallCount: 0,
          matchedCount: 0,
          unmatchedCount: 0,
          unmatchedTrackerNames: [],
          sampleUnmatchedCalls: [],
          error: describeError(err),
        });
        continue;
      }

      const unmatchedCalls = tagged.filter(
        (c) => filtersLower.length > 0 && !matchesAnyFilter(c.trackerName, filtersLower),
      );
      const unmatchedTrackerNames = [...new Set(unmatchedCalls.map((c) => c.trackerName))];

      results.push({
        clientId: client.id,
        name: client.name,
        callrailCompanyId: client.callrailCompanyId,
        signedCaseTag: client.signedCaseTag,
        signedCaseNameFilters: client.signedCaseNameFilters,
        taggedCallCount: tagged.length,
        matchedCount: tagged.length - unmatchedCalls.length,
        unmatchedCount: unmatchedCalls.length,
        unmatchedTrackerNames,
        sampleUnmatchedCalls: unmatchedCalls.slice(0, 10),
      });
    }

    const clientsWithMismatches = results.filter((r) => r.unmatchedCount > 0);

    return NextResponse.json({
      window: { fromDate, toDate, days },
      clientsChecked: results.length,
      clientsWithMismatches: clientsWithMismatches.length,
      mismatchClientNames: clientsWithMismatches.map((r) => r.name),
      results,
    });
  } catch (err) {
    return NextResponse.json({ error: describeError(err) }, { status: 500 });
  }
}
