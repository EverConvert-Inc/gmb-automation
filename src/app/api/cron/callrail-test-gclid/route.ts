import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

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
  const toDate = url.searchParams.get("to") ?? new Date().toISOString().slice(0, 10);
  const fromDate =
    url.searchParams.get("from") ??
    new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  try {
    const accountId = await resolveAccountId();
    const callsUrl = new URL(`${BASE_URL}/v3/a/${accountId}/calls.json`);
    callsUrl.searchParams.set("company_id", companyId);
    // 50 with no paging only ever saw the newest 50 calls — far too few to
    // measure gclid coverage per tracker. Pages through the full window the
    // same way callrail.ts's production pull does.
    callsUrl.searchParams.set("per_page", "250");
    callsUrl.searchParams.set("start_date", fromDate);
    callsUrl.searchParams.set("end_date", toDate);
    // `ga_client_id` is NOT a valid CallRail field — it made this route 400
    // on every call since it was written, so the gclid question was never
    // actually answered. Field names below are from CallRail's own
    // "Valid fields are ..." error listing.
    callsUrl.searchParams.set(
      "fields",
      "gclid,fbclid,msclkid,utm_source,utm_medium,utm_campaign,utm_term,utm_content,landing_page_url,referring_url,referrer_domain,source,source_name,medium,campaign,keywords,first_call,duration,direction,customer_phone_number,tags,tracker_id",
    );

    const calls: Array<{ gclid?: string | null }> = [];
    let totalRecords = 0;
    for (let page = 1; page <= 40; page += 1) {
      callsUrl.searchParams.set("page", String(page));
      const res = await fetch(callsUrl.toString(), { headers: authHeaders() });
      const bodyText = await res.text();
      if (!res.ok) {
        return NextResponse.json(
          { accountId, companyId, fromDate, toDate, page, status: res.status, body: bodyText },
          { status: 502 },
        );
      }
      const body = JSON.parse(bodyText) as {
        calls?: unknown[];
        total_records?: number;
        total_pages?: number;
      };
      totalRecords = body.total_records ?? totalRecords;
      for (const c of (body.calls ?? []) as Array<{ gclid?: string | null }>) calls.push(c);
      if (!body.total_pages || page >= body.total_pages) break;
    }
    const withGclid = calls.filter((c) => !!c.gclid).length;

    // Tracker configuration (type/source/destination/swap targets) — answers
    // what a given tracking number actually IS, which the calls endpoint
    // alone can't: a tracker's `type` ("source" vs "session") and `source`
    // say whether its number is swapped onto the site for a given traffic
    // source or handed out statically (e.g. a chat widget).
    const trackersUrl = new URL(`${BASE_URL}/v3/a/${accountId}/trackers.json`);
    trackersUrl.searchParams.set("company_id", companyId);
    trackersUrl.searchParams.set("per_page", "250");
    const trackersRes = await fetch(trackersUrl.toString(), { headers: authHeaders() });
    const trackersText = await trackersRes.text();
    const trackers = trackersRes.ok
      ? ((JSON.parse(trackersText) as { trackers?: unknown[] }).trackers ?? [])
      : { error: trackersRes.status, body: trackersText.slice(0, 500) };

    return NextResponse.json({
      accountId,
      companyId,
      fromDate,
      toDate,
      totalRecords: totalRecords || calls.length,
      returnedCount: calls.length,
      callsWithGclid: withGclid,
      trackers,
      calls,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ companyId, fromDate, toDate, error: message }, { status: 500 });
  }
}
