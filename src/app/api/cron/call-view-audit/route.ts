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
// resource exposes for one PPC client's Google Ads customer on a single
// day, completely unfiltered by our own assumptions about what's
// populated — investigating whether call_view is even the resource behind
// the Ads UI's call-conversion report, and if so what precision/fields it
// actually carries. Cross-checked against a known real CallRail call
// (Hodgins & Kiber, caller 678-704-9350, Jul 28 ~2:10pm, 4m9s duration).
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

    // No WHERE beyond the date — we want every call_view row that day so
    // the 4m9s ~2:10pm call can be picked out by eye and compared against
    // CallRail's record, rather than pre-filtering on an assumption about
    // which fields would identify it.
    const rows = await customer.query(`
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
        campaign.name,
        segments.date
      FROM call_view
      WHERE segments.date = '${date}'
      ORDER BY call_view.start_call_date_time
    `);

    return NextResponse.json({
      clientName: client.name,
      customerId: client.googleAdsCustomerId,
      date,
      rowCount: rows.length,
      rows,
    });
  } catch (err) {
    return NextResponse.json(
      { clientName, date, error: describeError(err) },
      { status: 500 },
    );
  }
}
