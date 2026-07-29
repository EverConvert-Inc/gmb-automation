import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { ppcClients, oauthCredentials } from "@/lib/db/schema";
import { eq, ilike } from "drizzle-orm";
import { decryptString } from "@/lib/crypto";
import { getCustomer } from "@/lib/google-ads";

export const runtime = "nodejs";
export const maxDuration = 300;

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

// JSON.stringify-safe replacer — Google Ads client errors can carry
// circular refs (sockets/connections) and bigints, either of which throws
// inside a plain JSON.stringify.
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

// The google-ads-api client often throws plain gRPC-style error objects
// (not real Error instances) with structured fields like `errors`/`details`
// — `String(err)` on those just gives "[object Object]", which is what
// happened here. Surface everything we can find instead: for real Error
// instances, walk own properties (Google's client sometimes attaches
// `.errors`/`.request_id` onto an Error too) rather than just `.message`;
// for anything else, safely stringify the whole object.
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

// Temporary read-only diagnostic. Pulls every field Google Ads' call_view
// resource exposes for one PPC client's Google Ads customer, completely
// unfiltered by our own assumptions about what's populated — investigating
// whether call_view is even the resource behind the Ads UI's
// call-conversion report, and if so what precision/fields it actually
// carries. Cross-checked against a known real CallRail call (Hodgins &
// Kiber, caller 678-704-9350, Jul 28 ~2:10pm, 4m9s duration).
//
// call_view does NOT support segments.date in SELECT or WHERE at all —
// confirmed live via a real PROHIBITED_SEGMENT_IN_SELECT_OR_WHERE_CLAUSE
// error, not a query typo. campaign.id/campaign.name are call_view's
// documented "Attributed Resources" (selectable/filterable, but don't
// segment the result set) — segments.date isn't in call_view's compatible-
// segments list the way it is for campaign/local_services_lead. So instead
// of filtering server-side by date, we pull back the most recent rows
// (capped + ordered, so a high-volume account doesn't return years of
// history in one shot) and bucket by date client-side after the fact —
// reporting both the total unfiltered count and the date-matched subset,
// so we can see how far back call_view actually goes and whether
// server-side date filtering is possible at all for a future daily sync.
//
// Reuses the same auth path pullDailyMetrics already relies on
// (getCustomer via a decrypted stored refresh token) — no new auth/scopes.
// No DB writes, no matching/aggregation logic. Delete once the report is
// scoped.
//
// Usage: ?client=<ppc_clients.name substring>&date=YYYY-MM-DD
export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const clientName = url.searchParams.get("client");
  const date = url.searchParams.get("date");
  if (!clientName || !date) {
    return NextResponse.json(
      {
        error:
          "client (ppc_clients.name substring) and date (YYYY-MM-DD) query params are required",
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
    if (!client.googleAdsCustomerId || !client.googleAdsOauthTokenId) {
      return NextResponse.json(
        {
          error: `${client.name} is missing googleAdsCustomerId or googleAdsOauthTokenId`,
        },
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
    const customer = getCustomer(refreshToken, client.googleAdsCustomerId);

    // No date filter — call_view rejects segments.date entirely (see the
    // comment above). Pull the most recent rows instead, capped so a
    // high-volume account can't return an unbounded amount of history in
    // one shot, and bucket by date client-side below.
    const rows = (await customer.query(`
      SELECT
        call_view.caller_country_code,
        call_view.caller_area_code,
        call_view.call_duration_seconds,
        call_view.start_call_date_time,
        call_view.end_call_date_time,
        call_view.call_tracking_display_location,
        call_view.type,
        call_view.call_status,
        campaign.id,
        campaign.name
      FROM call_view
      ORDER BY call_view.start_call_date_time DESC
      LIMIT 1000
    `)) as Array<{
      call_view?: { start_call_date_time?: string | null };
    }>;

    const matchingDate = rows.filter((r) =>
      (r.call_view?.start_call_date_time ?? "").startsWith(date),
    );
    const oldestReturned = rows.at(-1) as
      | { call_view?: { start_call_date_time?: string | null } }
      | undefined;
    const newestReturned = rows[0] as
      | { call_view?: { start_call_date_time?: string | null } }
      | undefined;

    return NextResponse.json({
      clientName: client.name,
      customerId: client.googleAdsCustomerId,
      requestedDate: date,
      totalRowsReturned: rows.length,
      returnedRange: {
        newest: newestReturned?.call_view?.start_call_date_time ?? null,
        oldest: oldestReturned?.call_view?.start_call_date_time ?? null,
      },
      matchingDateCount: matchingDate.length,
      matchingDateRows: matchingDate,
    });
  } catch (err) {
    return NextResponse.json(
      { clientName, date, error: describeError(err) },
      { status: 500 },
    );
  }
}
