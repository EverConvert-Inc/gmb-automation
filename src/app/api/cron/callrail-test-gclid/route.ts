import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const BASE_URL = process.env.CALLRAIL_API_BASE ?? "https://api.callrail.com";

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

function authHeaders(): HeadersInit {
  const key = process.env.CALLRAIL_API_KEY;
  if (!key) throw new Error("CALLRAIL_API_KEY not set");
  return {
    Authorization: `Token token="${key}"`,
    "Content-Type": "application/json",
  };
}

async function resolveAccountId(): Promise<string> {
  const pinned = process.env.CALLRAIL_ACCOUNT_ID;
  if (pinned) return pinned;
  const res = await fetch(`${BASE_URL}/v3/a.json`, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`CallRail accounts fetch failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { accounts?: Array<{ id: string }> };
  const first = body.accounts?.[0];
  if (!first) throw new Error("No CallRail accounts visible with this API key");
  return first.id;
}

// Temporary read-only diagnostic: is CallRail actually capturing gclid (and
// the rest of its click/UTM attribution) on real calls? Our production pull
// in callrail.ts only ever requests tags/duration/source_name/
// formatted_tracking_source/first_call/customer_phone_number — this adds
// the attribution fields CallRail's docs list as available on the Calls
// resource (gclid, ga_client_id, utm_*, landing_page_url, referrer_domain)
// to see what's actually populated, before deciding whether pulling gclid
// is worth adding to the real sync as a more precise call-to-campaign
// match than the current name-filter/tag-category heuristics. If any field
// name here is wrong, CallRail 400s with a message naming it (same
// behavior noted for `first_call` in callrail.ts) rather than silently
// dropping it. No DB writes. Delete once confirmed either way.
export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const companyId = url.searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json(
      { error: "?companyId=<callrail_company_id> is required" },
      { status: 400 },
    );
  }
  const days = Number(url.searchParams.get("days") ?? "30");
  const toDate = new Date().toISOString().slice(0, 10);
  const fromDate = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  try {
    const accountId = await resolveAccountId();
    const callsUrl = new URL(`${BASE_URL}/v3/a/${accountId}/calls.json`);
    callsUrl.searchParams.set("company_id", companyId);
    callsUrl.searchParams.set("per_page", "50");
    callsUrl.searchParams.set("start_date", fromDate);
    callsUrl.searchParams.set("end_date", toDate);
    callsUrl.searchParams.set(
      "fields",
      "gclid,ga_client_id,utm_source,utm_medium,utm_campaign,utm_term,utm_content,landing_page_url,referrer_domain,source_name",
    );

    const res = await fetch(callsUrl.toString(), { headers: authHeaders() });
    const bodyText = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { accountId, companyId, fromDate, toDate, status: res.status, body: bodyText },
        { status: 502 },
      );
    }
    const body = JSON.parse(bodyText) as { calls?: unknown[]; total_records?: number };
    const calls = (body.calls ?? []) as Array<{ gclid?: string | null }>;
    const withGclid = calls.filter((c) => !!c.gclid).length;

    return NextResponse.json({
      accountId,
      companyId,
      fromDate,
      toDate,
      totalRecords: body.total_records ?? calls.length,
      returnedCount: calls.length,
      callsWithGclid: withGclid,
      calls,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ companyId, fromDate, toDate, error: message }, { status: 500 });
  }
}
