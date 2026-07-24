import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const BASE_URL = process.env.CALLRAIL_API_BASE ?? "https://api.callrail.com";

function authHeaders(): HeadersInit {
  const key = process.env.CALLRAIL_API_KEY;
  if (!key) throw new Error("CALLRAIL_API_KEY not set");
  return {
    Authorization: `Token token="${key}"`,
    "Content-Type": "application/json",
  };
}

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

async function resolveAccountId(): Promise<string> {
  const pinned = process.env.CALLRAIL_ACCOUNT_ID;
  if (pinned) return pinned;
  const res = await fetch(`${BASE_URL}/v3/a.json`, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`accounts fetch failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { accounts?: Array<{ id: string }> };
  const first = body.accounts?.[0];
  if (!first) throw new Error("No CallRail accounts visible with this API key");
  return first.id;
}

// Temporary read-only diagnostic. Pulls the RAW /calls.json response
// (unfiltered by our own field-selection assumptions) for one specific
// CallRail company + single day, to confirm whether `first_call` is
// actually present and boolean on real calls, or missing/null — per
// investigating why /call-quality's PPC "first-time calls" figure looked
// implausibly high relative to tagged-call volume. No DB writes, no
// aggregation logic reused — this queries CallRail directly so the
// answer isn't filtered through any of our own assumptions.
//
// Usage: ?company_id=<callrail company id>&date=YYYY-MM-DD
export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const companyId = url.searchParams.get("company_id");
  const date = url.searchParams.get("date");
  if (!companyId || !date) {
    return NextResponse.json(
      { error: "company_id and date (YYYY-MM-DD) query params are required" },
      { status: 400 },
    );
  }

  try {
    const accountId = await resolveAccountId();

    const calls: Array<Record<string, unknown>> = [];
    let page = 1;
    while (true) {
      const callsUrl = new URL(`${BASE_URL}/v3/a/${accountId}/calls.json`);
      callsUrl.searchParams.set("company_id", companyId);
      callsUrl.searchParams.set("page", String(page));
      callsUrl.searchParams.set("per_page", "250");
      callsUrl.searchParams.set("start_date", date);
      callsUrl.searchParams.set("end_date", date);
      // No `fields` param at all — request the FULL default call object,
      // not our own assumed field list, so we see everything CallRail
      // actually returns for a call (including whether first_call exists
      // under this exact name or something else).
      const res = await fetch(callsUrl.toString(), { headers: authHeaders() });
      if (!res.ok) {
        throw new Error(
          `calls fetch failed: ${res.status} ${await res.text()}`,
        );
      }
      const body = (await res.json()) as {
        calls?: Array<Record<string, unknown>>;
        total_pages?: number;
      };
      for (const c of body.calls ?? []) calls.push(c);
      if (!body.total_pages || page >= body.total_pages) break;
      page += 1;
    }

    let firstCallTrue = 0;
    let firstCallFalse = 0;
    let firstCallMissing = 0; // undefined or null
    let firstCallOtherType = 0;
    let taggedCount = 0;
    let untaggedCount = 0;
    const distinctFirstCallValues = new Set<string>();

    for (const c of calls) {
      const fc = c.first_call;
      distinctFirstCallValues.add(JSON.stringify(fc));
      if (fc === true) firstCallTrue += 1;
      else if (fc === false) firstCallFalse += 1;
      else if (fc === null || fc === undefined) firstCallMissing += 1;
      else firstCallOtherType += 1;

      const tags = c.tags;
      const hasTags = Array.isArray(tags) && tags.length > 0;
      if (hasTags) taggedCount += 1;
      else untaggedCount += 1;
    }

    return NextResponse.json({
      companyId,
      date,
      totalCallsThatDay: calls.length,
      firstCallBreakdown: {
        true: firstCallTrue,
        false: firstCallFalse,
        missing_null_or_undefined: firstCallMissing,
        unexpectedType: firstCallOtherType,
        distinctRawValuesSeen: Array.from(distinctFirstCallValues),
      },
      taggedVsUntagged: { taggedCount, untaggedCount },
      // First 5 raw calls, completely unfiltered, so the exact key names
      // and types can be inspected directly.
      sampleRawCalls: calls.slice(0, 5),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { companyId, date, error: message },
      { status: 500 },
    );
  }
}
