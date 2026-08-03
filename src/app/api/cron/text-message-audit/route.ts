import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { ppcClients } from "@/lib/db/schema";
import { ilike } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 300;

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

// Same safe-stringify/describeError pattern as pmax-match-audit — Google
// Ads client errors can carry circular refs/bigints, and fetch/JSON errors
// here should surface fully rather than collapsing to "[object Object]".
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

// --- Minimal CallRail fetch, mirroring src/lib/callrail.ts's auth/account
// resolution exactly (same pattern pmax-match-audit already duplicates for
// the same reason) but kept separate here — this hits a different resource
// (text-messages, not calls) that pullCallsForCompany doesn't know about.
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

// Temporary read-only diagnostic: does CallRail's text-message conversation
// resource — distinct from /calls.json, which is all pullCallsForCompany
// ever fetches — carry enough signal to tell a Signed message conversation
// apart from others? Real gap under investigation: at least 2 real
// conversations have been manually confirmed tagged "Signed" in CallRail's
// own text-conversation view, using an LSA client's tracking number, but
// the sync never pulls message conversations at all — those signed leads
// are silently uncounted today.
//
// First run (requesting tags/source_name/formatted_tracking_source,
// mirroring /calls.json's fields) 400'd — CallRail confirmed this
// resource has NO `tags` field at all, despite the UI showing a "Tags"
// column for text conversations. Valid fields per that error: id,
// initial_tracker_id, current_tracker_id, customer_name,
// customer_phone_number, initial_tracking_number, current_tracking_number,
// last_message_at, state, formatted_customer_phone_number,
// formatted_initial_tracking_number, formatted_current_tracking_number,
// formatted_customer_name, company_time_zone, tracker_name, company_name,
// company_id, recent_messages, lead_status, source. This request now asks
// for tracker_name/lead_status/source/customer_phone_number/
// recent_messages — lead_status is the candidate for where a message's
// Signed-equivalent status actually lives (the UI's "Tags" column may be
// synthesized client-side from lead_status, or from something in
// recent_messages, rather than a real per-conversation tags array), and
// source is the candidate tracker/channel-type signal. Still the same
// "ask the live API, don't trust docs" approach already used for
// calls.json's first_call/customer_phone_number fields (see callrail.ts):
// returns CallRail's response completely unprocessed (not re-shaped into
// our own types) so lead_status's actual values are visible directly.
// Single page only (per_page=250, no pagination loop) — this is a one-off
// sample for one client/date range, not a production puller; narrow the
// date range further if a client hits the cap. No DB writes, no changes
// to production sync logic. Delete once answered.
//
// Usage (list mode): /api/cron/text-message-audit?client=<ppc_clients.name substring>&from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Usage (single-conversation mode): /api/cron/text-message-audit?client=<...>&conversationId=<id>
// Hits GET /v3/a/{account_id}/text-messages/{conversationId}.json instead —
// added to empirically check whether a single-conversation fetch returns
// more than the list endpoint's "two most recent messages" per
// conversation (per CallRail's own docs, a fixed property of the
// conversation resource, not a list-pagination artifact — but worth
// confirming live rather than trusting a search-result description of the
// docs, same "ask the live API" approach as everything else here). Pick a
// conversation id from a prior list-mode response, ideally one with a
// last_message_at that's clearly much later than when the conversation
// likely first started.
//
// This endpoint rejected `recent_messages` as a field name (400) — the
// valid field on the single-conversation resource is `messages` instead.
// Different name, and possibly a genuinely different (fuller) list than
// the list endpoint's 2-message preview — that's exactly what this mode
// exists to check, so the count is read from `messages` here, not
// `recent_messages`.
export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const clientName = url.searchParams.get("client");
  const conversationId = url.searchParams.get("conversationId");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!clientName) {
    return NextResponse.json(
      { error: "client (ppc_clients.name substring) query param is required" },
      { status: 400 },
    );
  }
  if (!conversationId && (!from || !to)) {
    return NextResponse.json(
      {
        error:
          "either conversationId (single-conversation mode), or both from and to (YYYY-MM-DD, list mode), are required",
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

    const accountId = await resolveCallrailAccountId();

    const fetchUrl = conversationId
      ? new URL(
          `${CALLRAIL_BASE_URL}/v3/a/${accountId}/text-messages/${conversationId}.json`,
        )
      : new URL(`${CALLRAIL_BASE_URL}/v3/a/${accountId}/text-messages.json`);
    if (conversationId) {
      fetchUrl.searchParams.set("fields", "tracker_name,messages");
    } else {
      fetchUrl.searchParams.set("company_id", client.callrailCompanyId);
      fetchUrl.searchParams.set("page", "1");
      fetchUrl.searchParams.set("per_page", "250");
      fetchUrl.searchParams.set("start_date", from!);
      fetchUrl.searchParams.set("end_date", to!);
      fetchUrl.searchParams.set(
        "fields",
        "tracker_name,lead_status,source,customer_phone_number,recent_messages",
      );
    }

    const res = await fetch(fetchUrl.toString(), {
      headers: callrailAuthHeaders(),
    });
    const rawBody = await res.text();
    let parsedBody: unknown = rawBody;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      // Not JSON — leave parsedBody as the raw text (e.g. an HTML error
      // page would prove the endpoint/params are wrong outright).
    }

    // Single-conversation mode's whole point — surfaced at the top level
    // so the answer ("does this exceed 2?") doesn't require digging
    // through the raw body by hand. Reads `messages` here (this
    // resource's actual field name), not `recent_messages` (the list
    // endpoint's field, rejected as invalid on this one).
    const messagesCount =
      conversationId &&
      parsedBody &&
      typeof parsedBody === "object" &&
      Array.isArray((parsedBody as Record<string, unknown>).messages)
        ? ((parsedBody as Record<string, unknown>).messages as unknown[]).length
        : null;

    return NextResponse.json(
      {
        clientName: client.name,
        callrailCompanyId: client.callrailCompanyId,
        mode: conversationId ? "single-conversation" : "list",
        conversationId,
        from,
        to,
        messagesCount,
        requestUrl: fetchUrl.toString(),
        responseStatus: res.status,
        responseOk: res.ok,
        responseBody: parsedBody,
      },
      { status: res.ok ? 200 : 502 },
    );
  } catch (err) {
    return NextResponse.json(
      { clientName, conversationId, from, to, error: describeError(err) },
      { status: 500 },
    );
  }
}
