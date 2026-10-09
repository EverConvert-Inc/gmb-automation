import { NextResponse } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { lsaClients, oauthCredentials } from "@/lib/db/schema";
import { decryptString } from "@/lib/crypto";
import { getCustomer } from "@/lib/google-ads";

export const runtime = "nodejs";
export const maxDuration = 300;

const CALLRAIL_BASE = process.env.CALLRAIL_API_BASE ?? "https://api.callrail.com";

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function callrailHeaders(): HeadersInit {
  const key = process.env.CALLRAIL_API_KEY;
  if (!key) throw new Error("CALLRAIL_API_KEY not set");
  return { Authorization: `Token token="${key}"`, "Content-Type": "application/json" };
}

async function resolveAccountId(): Promise<string> {
  const pinned = process.env.CALLRAIL_ACCOUNT_ID;
  if (pinned) return pinned;
  const res = await fetch(`${CALLRAIL_BASE}/v3/a.json`, { headers: callrailHeaders() });
  if (!res.ok) throw new Error(`CallRail accounts fetch failed: ${res.status}`);
  const body = (await res.json()) as { accounts?: Array<{ id: string }> };
  const first = body.accounts?.[0];
  if (!first) throw new Error("No CallRail accounts visible");
  return first.id;
}

// Last 10 digits — CallRail returns "+14232068665", Google's lead contact
// details may be formatted differently, so compare on the national number.
function digits10(v: unknown): string {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

// LSA creation_date_time is "YYYY-MM-DD HH:MM:SS.ssssss" in the account's
// own timezone; CallRail start_time is ISO-8601 carrying an offset. Both
// describe the same wall clock in Eastern, so compare the local time-of-day
// the same way the PPC call_view matcher already does.
function leadEpochLocal(s: string): number | null {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000;
}
function callEpochLocal(s: string): number | null {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000;
}

// Temporary read-only diagnostic: how reliably can an LSA lead be matched
// to its CallRail call? Matches on national phone number first, then time
// proximity, and reports exact / ambiguous / no-match counts so the
// matching rule can be judged on real data before anything is built on it.
//
// Also reports whether the matched CallRail call carries a transcription,
// since that is the actual input a lead-rating classifier would read.
//
// No DB writes, no writes to Google, not in vercel.json.
// Usage: ?customerId=<google ads customer id>[&days=30][&windowMin=10]
export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const customerId = url.searchParams.get("customerId");
  const days = Number(url.searchParams.get("days") ?? "30");
  const windowMin = Number(url.searchParams.get("windowMin") ?? "10");
  if (!customerId) {
    return NextResponse.json({ error: "?customerId= is required" }, { status: 400 });
  }

  const client = await db.query.lsaClients.findFirst({
    where: and(
      eq(lsaClients.googleAdsCustomerId, customerId),
      isNotNull(lsaClients.googleAdsOauthTokenId),
    ),
  });
  if (!client) {
    return NextResponse.json({ error: `No lsa_clients row for ${customerId}` }, { status: 404 });
  }
  if (!client.callrailCompanyId) {
    return NextResponse.json(
      { error: `${client.name} has no callrail_company_id` },
      { status: 400 },
    );
  }
  const cred = await db.query.oauthCredentials.findFirst({
    where: eq(oauthCredentials.id, client.googleAdsOauthTokenId!),
  });
  if (!cred) return NextResponse.json({ error: "oauth credential missing" }, { status: 404 });

  const toDate = new Date().toISOString().slice(0, 10);
  const fromDate = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  // --- LSA leads (phone-call leads only; messages have no CallRail call).
  let leads: Array<Record<string, unknown>> = [];
  try {
    const customer = getCustomer(
      decryptString(cred.refreshTokenEncrypted),
      customerId,
      client.loginCustomerId ?? undefined,
    );
    const rows = (await customer.query(`
      SELECT
        local_services_lead.id,
        local_services_lead.lead_type,
        local_services_lead.lead_status,
        local_services_lead.service_id,
        local_services_lead.category_id,
        local_services_lead.lead_feedback_submitted,
        local_services_lead.contact_details,
        local_services_lead.creation_date_time
      FROM local_services_lead
      WHERE local_services_lead.creation_date_time BETWEEN '${fromDate} 00:00:00' AND '${toDate} 23:59:59'
    `)) as Array<Record<string, unknown>>;
    leads = rows.map((r) => (r.local_services_lead ?? {}) as Record<string, unknown>);
  } catch (err) {
    return NextResponse.json({ error: `lead pull failed: ${describeError(err)}` }, { status: 502 });
  }

  // --- CallRail calls for the same company/window.
  const calls: Array<Record<string, unknown>> = [];
  try {
    const accountId = await resolveAccountId();
    for (let page = 1; page <= 40; page += 1) {
      const u = new URL(`${CALLRAIL_BASE}/v3/a/${accountId}/calls.json`);
      u.searchParams.set("company_id", client.callrailCompanyId);
      u.searchParams.set("per_page", "250");
      u.searchParams.set("page", String(page));
      u.searchParams.set("start_date", fromDate);
      u.searchParams.set("end_date", toDate);
      u.searchParams.set(
        "fields",
        "customer_phone_number,duration,direction,source_name,transcription,recording,first_call",
      );
      const res = await fetch(u.toString(), { headers: callrailHeaders() });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      const body = (await res.json()) as {
        calls?: Array<Record<string, unknown>>;
        total_pages?: number;
      };
      for (const c of body.calls ?? []) calls.push(c);
      if (!body.total_pages || page >= body.total_pages) break;
    }
  } catch (err) {
    return NextResponse.json(
      { error: `callrail pull failed: ${describeError(err)}` },
      { status: 502 },
    );
  }

  const byPhone = new Map<string, Array<Record<string, unknown>>>();
  for (const c of calls) {
    if (c.direction !== "inbound") continue;
    const p = digits10(c.customer_phone_number);
    if (!p) continue;
    const arr = byPhone.get(p) ?? [];
    arr.push(c);
    byPhone.set(p, arr);
  }

  const windowSec = windowMin * 60;
  const outcome = { exact: 0, ambiguous: 0, no_match: 0, no_phone_on_lead: 0, not_a_call_lead: 0 };
  const withTranscript = { exact: 0 };
  const samples: Array<Record<string, unknown>> = [];
  const contactShapes = new Set<string>();

  for (const l of leads) {
    // lead_type 2 === PHONE_CALL; message leads have no CallRail call to find.
    if (l.lead_type !== 2) {
      outcome.not_a_call_lead += 1;
      continue;
    }
    const cd = l.contact_details;
    if (cd && typeof cd === "object") contactShapes.add(Object.keys(cd as object).sort().join(","));
    const phone = digits10(
      (cd as { phone_number?: unknown } | null)?.phone_number ?? (cd as unknown),
    );
    if (!phone) {
      outcome.no_phone_on_lead += 1;
      continue;
    }
    const leadAt = leadEpochLocal(String(l.creation_date_time ?? ""));
    const candidates = (byPhone.get(phone) ?? []).filter((c) => {
      const t = callEpochLocal(String(c.start_time ?? ""));
      return leadAt !== null && t !== null && Math.abs(t - leadAt) <= windowSec;
    });
    if (candidates.length === 1) {
      outcome.exact += 1;
      if (candidates[0].transcription) withTranscript.exact += 1;
      if (samples.length < 8) {
        samples.push({
          leadId: l.id,
          leadAt: l.creation_date_time,
          serviceId: l.service_id,
          rated: l.lead_feedback_submitted,
          callAt: candidates[0].start_time,
          tracker: candidates[0].source_name,
          hasTranscription: !!candidates[0].transcription,
          transcriptionPreview: String(candidates[0].transcription ?? "").slice(0, 180),
        });
      }
    } else if (candidates.length > 1) {
      outcome.ambiguous += 1;
    } else {
      outcome.no_match += 1;
    }
  }

  return NextResponse.json({
    client: { name: client.name, customerId, callrailCompanyId: client.callrailCompanyId },
    window: { fromDate, toDate, windowMin },
    totals: { leads: leads.length, callrailInboundCalls: byPhone.size ? calls.length : 0 },
    contactDetailsShapes: Array.from(contactShapes),
    matchOutcome: outcome,
    exactMatchesWithTranscription: withTranscript.exact,
    samples,
  });
}
