import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { ppcClients, oauthCredentials } from "@/lib/db/schema";
import { eq, ilike } from "drizzle-orm";
import { decryptString } from "@/lib/crypto";
import { pullCallViewRows } from "@/lib/google-ads";
import {
  createGmbAdMatcher,
  extractLocalTimeOfDay,
  timeOfDaySeconds,
} from "@/lib/callrail";

export const runtime = "nodejs";
export const maxDuration = 300;

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

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

// --- Minimal CallRail fetch, mirroring src/lib/callrail.ts's request shape
// exactly (same fields, same pagination) but kept separate here since this
// diagnostic needs the RAW calls, not callrail.ts's aggregated
// CallrailDailyTotals output.
const CALLRAIL_BASE_URL = process.env.CALLRAIL_API_BASE ?? "https://api.callrail.com";

function callrailAuthHeaders(): HeadersInit {
  const key = process.env.CALLRAIL_API_KEY;
  if (!key) throw new Error("CALLRAIL_API_KEY not set");
  return {
    Authorization: `Token token="${key}"`,
    "Content-Type": "application/json",
  };
}

async function resolveCallrailAccountId(): Promise<string> {
  const pinned = process.env.CALLRAIL_ACCOUNT_ID;
  if (pinned) return pinned;
  const res = await fetch(`${CALLRAIL_BASE_URL}/v3/a.json`, {
    headers: callrailAuthHeaders(),
  });
  if (!res.ok) {
    throw new Error(`CallRail accounts fetch failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { accounts?: Array<{ id: string }> };
  const first = body.accounts?.[0];
  if (!first) throw new Error("No CallRail accounts visible with this API key");
  return first.id;
}

type RawCallrailCall = {
  id: string;
  start_time: string;
  duration: number | null;
  tags: Array<{ id: number; name: string } | string> | null;
  source_name?: string | null;
  formatted_tracking_source?: string | null;
  first_call?: boolean | null;
  customer_phone_number?: string | null;
};

async function pullRawCallrailCalls(
  companyId: string,
  fromDate: string,
  toDate: string,
): Promise<RawCallrailCall[]> {
  const accountId = await resolveCallrailAccountId();
  const calls: RawCallrailCall[] = [];
  let page = 1;
  while (true) {
    const url = new URL(`${CALLRAIL_BASE_URL}/v3/a/${accountId}/calls.json`);
    url.searchParams.set("company_id", companyId);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", "250");
    url.searchParams.set("start_date", fromDate);
    url.searchParams.set("end_date", toDate);
    url.searchParams.set(
      "fields",
      "tags,duration,source_name,formatted_tracking_source,first_call,customer_phone_number",
    );
    const res = await fetch(url.toString(), { headers: callrailAuthHeaders() });
    if (!res.ok) {
      throw new Error(`CallRail calls fetch failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as {
      calls?: RawCallrailCall[];
      total_pages?: number;
    };
    for (const c of body.calls ?? []) calls.push(c);
    if (!body.total_pages || page >= body.total_pages) break;
    page += 1;
  }
  return calls;
}

// Temporary read-only diagnostic. For every GMB-tracker CallRail call in
// the given window, runs the SAME createGmbAdMatcher used in production
// (src/lib/callrail.ts) against real call_view rows, and reports the exact
// timestamp/duration/area-code deltas for every match AND every near-miss
// — not just a pass/fail count. Purpose: confirm whether current PMax
// matches are tight (near-zero deltas, like the confirmed Hodgins & Kiber
// case) or loose (near the 5s/3s tolerance edges), which would suggest
// false positives inflating the PMax count.
//
// "Website" vs "Ad" source calls (a Google Ads-side conversion-source
// distinction, not a CallRail field) — under investigation for whether
// this actually maps to call_view.call_tracking_display_location's
// AD/LANDING_PAGE values. This route now reports
// callViewDisplayLocationBreakdown (a tally across every available
// call_view row, not just matched ones) plus the raw callViewRows
// themselves, so the real field values can be inspected directly before
// concluding whether call_view only ever returns "Ad" source activity for
// this account or actually covers both.
//
// No DB writes, no changes to production matching logic (imports the real
// createGmbAdMatcher, doesn't reimplement it). Delete once match quality
// is confirmed.
//
// Usage: ?client=<ppc_clients.name substring>&from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const clientName = url.searchParams.get("client");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!clientName || !from || !to) {
    return NextResponse.json(
      {
        error:
          "client (ppc_clients.name substring), from, and to (YYYY-MM-DD) query params are required",
      },
      { status: 400 },
    );
  }

  try {
    const client = await db.query.ppcClients.findFirst({
      where: ilike(ppcClients.name, `%${clientName}%`),
    });
    if (!client) {
      return NextResponse.json(
        { error: `No ppc_clients row matching "${clientName}"` },
        { status: 404 },
      );
    }
    if (!client.callrailCompanyId) {
      return NextResponse.json(
        { error: `${client.name} has no callrailCompanyId configured` },
        { status: 400 },
      );
    }
    if (!client.googleAdsCustomerId || !client.googleAdsOauthTokenId) {
      return NextResponse.json(
        {
          error: `${client.name} is missing googleAdsCustomerId or googleAdsOauthTokenId`,
        },
        { status: 400 },
      );
    }
    const gmbFilters = client.gmbCallrailNameFilters
      .map((f) => f.trim().toLowerCase())
      .filter(Boolean);
    if (gmbFilters.length === 0) {
      return NextResponse.json(
        { error: `${client.name} has no gmbCallrailNameFilters configured` },
        { status: 400 },
      );
    }

    const cred = await db.query.oauthCredentials.findFirst({
      where: eq(oauthCredentials.id, client.googleAdsOauthTokenId),
    });
    if (!cred) {
      return NextResponse.json(
        { error: "oauth_credentials row not found" },
        { status: 404 },
      );
    }
    const refreshToken = decryptString(cred.refreshTokenEncrypted);
    const callViewRows = await pullCallViewRows(refreshToken, client.googleAdsCustomerId);

    const rawCalls = await pullRawCallrailCalls(client.callrailCompanyId, from, to);
    const gmbCalls = rawCalls.filter((c) => {
      const trackerName = (c.source_name ?? c.formatted_tracking_source ?? "").toLowerCase();
      return gmbFilters.some((f) => trackerName.includes(f));
    });

    const matcher = createGmbAdMatcher(callViewRows);
    const results = gmbCalls.map((c) => {
      const result = matcher.match(
        c.start_time.slice(0, 10),
        c.start_time,
        c.duration,
        c.customer_phone_number,
      );
      return {
        callId: c.id,
        startTime: c.start_time,
        durationSeconds: c.duration,
        trackerName: c.source_name ?? c.formatted_tracking_source ?? null,
        callerPhone: c.customer_phone_number ?? null,
        ...result,
      };
    });

    // Tally across ALL available call_view rows (not just matched ones) —
    // answers whether call_view is returning a mix of AD/LANDING_PAGE for
    // this account, or only ever one type, before concluding anything
    // about why the matched count looks low.
    const callViewDisplayLocationBreakdown: Record<string, number> = {};
    for (const row of callViewRows) {
      const key = row.callTrackingDisplayLocation || "(blank)";
      callViewDisplayLocationBreakdown[key] =
        (callViewDisplayLocationBreakdown[key] ?? 0) + 1;
    }

    // --- Unconsumed call_view rows in [from, to], with any nearby CallRail
    // call regardless of tracker. Purely diagnostic (no production matching
    // logic touched): identifies which in-range call_view rows never backed
    // a match, then checks (a) any GMB-tracker call within a wider ±10min
    // window (a real but more-distant match tolerance would be missing),
    // and (b) any CallRail call AT ALL near that time, in case the call
    // landed on a differently-named tracker and was never even considered.
    const NEARBY_WINDOW_SECONDS = 600;
    const inRangeCallViewRows = callViewRows.filter((row) => {
      const rowDate = row.startCallDateTime.split(" ")[0];
      return rowDate >= from && rowDate <= to;
    });
    // Matched results carry exactly which call_view row they consumed
    // (bestCandidate.matchedStartCallDateTime/matchedCallDurationSeconds/
    // campaignId) — used here purely to identify unconsumed rows, not to
    // re-derive match outcomes.
    const consumedRowKeys = new Set(
      results
        .filter((r) => r.matched && r.bestCandidate)
        .map(
          (r) =>
            `${r.bestCandidate!.matchedStartCallDateTime}|${r.bestCandidate!.matchedCallDurationSeconds}|${r.bestCandidate!.campaignId}`,
        ),
    );
    const unconsumedCallViewRowsInRange = inRangeCallViewRows
      .filter(
        (row) =>
          !consumedRowKeys.has(
            `${row.startCallDateTime}|${row.callDurationSeconds}|${row.campaignId}`,
          ),
      )
      .map((row) => {
        const [rowDate, rowTime] = row.startCallDateTime.split(" ");
        const rowSeconds = rowTime ? timeOfDaySeconds(rowTime) : null;
        const nearbyCallsAnyTracker = rawCalls
          .filter((c) => {
            if (rowSeconds === null) return false;
            if (c.start_time.slice(0, 10) !== rowDate) return false;
            const localTime = extractLocalTimeOfDay(c.start_time);
            const callSeconds = localTime ? timeOfDaySeconds(localTime) : null;
            if (callSeconds === null) return false;
            return Math.abs(callSeconds - rowSeconds) <= NEARBY_WINDOW_SECONDS;
          })
          .map((c) => ({
            callId: c.id,
            startTime: c.start_time,
            durationSeconds: c.duration,
            trackerName: c.source_name ?? c.formatted_tracking_source ?? null,
            callerPhone: c.customer_phone_number ?? null,
            isGmbTracker: gmbCalls.includes(c),
          }));
        return { ...row, nearbyCallsAnyTracker };
      });

    return NextResponse.json({
      clientName: client.name,
      customerId: client.googleAdsCustomerId,
      from,
      to,
      totalCallViewRowsAvailable: callViewRows.length,
      callViewDisplayLocationBreakdown,
      totalGmbTrackerCalls: gmbCalls.length,
      matchedCount: results.filter((r) => r.matched).length,
      // Raw rows included so the actual field values (not just our
      // interpretation of them) are inspectable directly.
      callViewRows,
      results,
      inRangeCallViewRowCount: inRangeCallViewRows.length,
      nearbyWindowSeconds: NEARBY_WINDOW_SECONDS,
      unconsumedCallViewRowsInRange,
    });
  } catch (err) {
    return NextResponse.json(
      { clientName, from, to, error: describeError(err) },
      { status: 500 },
    );
  }
}
