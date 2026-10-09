import { NextResponse } from "next/server";
import { and, eq, ilike, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { lsaClients, oauthCredentials } from "@/lib/db/schema";
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

function safeStringify(value: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(value, (_k, v) => {
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "object" && v !== null) {
      if (seen.has(v)) return "[Circular]";
      seen.add(v);
    }
    return v;
  });
}

// google-ads-api throws gRPC-style objects, not Error instances — String()
// on those yields "[object Object]". Same handling as the other LSA/PMax
// diagnostics.
function describeError(err: unknown): unknown {
  if (err instanceof Error) {
    const extra: Record<string, unknown> = { message: err.message };
    for (const k of Object.getOwnPropertyNames(err)) {
      if (k === "stack" || k === "message") continue;
      extra[k] = (err as unknown as Record<string, unknown>)[k];
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

// Describes an id's shape so lead service_ids and criterion service_ids can
// be compared without assuming either is numeric — the snapshot match
// depends on them being the same KIND of value, not just both present.
function shapeOf(v: unknown): string {
  if (v === null || v === undefined) return "null";
  const s = String(v);
  if (s === "") return "empty";
  const kind = /^\d+$/.test(s)
    ? "digits"
    : /^[A-Za-z0-9_-]+$/.test(s)
      ? "alnum"
      : "other";
  return `${typeof v}:${kind}:len${s.length}`;
}

// Temporary read-only diagnostic for automated LSA lead rating. Answers, in
// one run against ONE LSA client:
//   1. does campaign_criterion return rows for LOCAL_SERVICES campaigns
//      (Google's docs conflict; the FIELD exists in v25, but whether LSA
//      campaigns expose criteria is an account-data question)
//   2. what category_id / service_id values real leads actually carry
//   3. how many leads already have lead_feedback_submitted = true
//   4. whether campaign.local_services_campaign_settings.category_bids is
//      populated as a fallback source of "what's switched on"
//   5. whether lead service_ids and criterion service_ids are comparable
//      (same shape + actual overlap) — the snapshot match depends on it
//
// Each query runs in its own try/catch: query 1 is the one most likely to
// fail, and a failure there must not hide the answers to the rest.
//
// Strictly read-only — nothing is written to Google (no ProvideLeadFeedback
// call) and nothing is written to the DB. Not registered in vercel.json.
// Delete once the rating approach is settled.
//
// Usage: /api/cron/lsa-test-service-criteria?client=<lsa_clients.name substring>[&days=30]
export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const clientName = url.searchParams.get("client");
  const days = Number(url.searchParams.get("days") ?? "30");

  const client = await db.query.lsaClients.findFirst({
    where: and(
      isNotNull(lsaClients.googleAdsCustomerId),
      isNotNull(lsaClients.googleAdsOauthTokenId),
      clientName ? ilike(lsaClients.name, `%${clientName}%`) : undefined,
    ),
  });
  if (!client) {
    return NextResponse.json(
      { error: `No lsa_clients row with Google Ads configured matching "${clientName ?? "(any)"}"` },
      { status: 404 },
    );
  }

  const cred = await db.query.oauthCredentials.findFirst({
    where: eq(oauthCredentials.id, client.googleAdsOauthTokenId!),
  });
  if (!cred) {
    return NextResponse.json({ error: "oauth_credentials row not found" }, { status: 404 });
  }

  const refreshToken = decryptString(cred.refreshTokenEncrypted);
  const customer = getCustomer(
    refreshToken,
    client.googleAdsCustomerId!,
    client.loginCustomerId ?? undefined,
  );

  const toDate = new Date().toISOString().slice(0, 10);
  const fromDate = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  // --- 1. campaign_criterion for LOCAL_SERVICES campaigns.
  // Deliberately NOT filtered on campaign.status — that reflects CURRENT
  // status and has already caused real data loss twice in this codebase.
  let criteria: unknown = null;
  let criteriaError: unknown = null;
  const criterionServiceIds: string[] = [];
  try {
    const rows = (await customer.query(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.advertising_channel_type,
        campaign_criterion.criterion_id,
        campaign_criterion.type,
        campaign_criterion.status,
        campaign_criterion.negative,
        campaign_criterion.local_service_id.service_id
      FROM campaign_criterion
      WHERE campaign.advertising_channel_type = 'LOCAL_SERVICES'
    `)) as Array<Record<string, unknown>>;
    criteria = {
      rowCount: rows.length,
      rows: rows.slice(0, 100),
    };
    for (const r of rows) {
      const cc = (r.campaign_criterion ?? {}) as {
        local_service_id?: { service_id?: unknown } | null;
      };
      const sid = cc.local_service_id?.service_id;
      if (sid !== undefined && sid !== null) criterionServiceIds.push(String(sid));
    }
  } catch (err) {
    criteriaError = describeError(err);
  }

  // --- 2 & 3 & 5. Real leads: what ids they carry, and how many are rated.
  let leads: unknown = null;
  let leadsError: unknown = null;
  const leadServiceIds: string[] = [];
  const leadCategoryIds: string[] = [];
  let feedbackSubmitted = 0;
  let leadCount = 0;
  try {
    const rows = (await customer.query(`
      SELECT
        local_services_lead.id,
        local_services_lead.category_id,
        local_services_lead.service_id,
        local_services_lead.lead_type,
        local_services_lead.lead_status,
        local_services_lead.lead_charged,
        local_services_lead.lead_feedback_submitted,
        local_services_lead.creation_date_time
      FROM local_services_lead
      WHERE local_services_lead.creation_date_time BETWEEN '${fromDate} 00:00:00' AND '${toDate} 23:59:59'
    `)) as Array<Record<string, unknown>>;
    leadCount = rows.length;
    const byCategory = new Map<string, number>();
    const byService = new Map<string, number>();
    for (const r of rows) {
      const l = (r.local_services_lead ?? {}) as Record<string, unknown>;
      if (l.lead_feedback_submitted === true) feedbackSubmitted += 1;
      const cat = l.category_id;
      const svc = l.service_id;
      if (cat !== undefined && cat !== null) {
        const s = String(cat);
        leadCategoryIds.push(s);
        byCategory.set(s, (byCategory.get(s) ?? 0) + 1);
      }
      if (svc !== undefined && svc !== null) {
        const s = String(svc);
        leadServiceIds.push(s);
        byService.set(s, (byService.get(s) ?? 0) + 1);
      }
    }
    leads = {
      leadCount,
      feedbackSubmitted,
      feedbackNotSubmitted: leadCount - feedbackSubmitted,
      distinctCategoryIds: Object.fromEntries(byCategory),
      distinctServiceIds: Object.fromEntries(byService),
      sampleRows: rows.slice(0, 10),
    };
  } catch (err) {
    leadsError = describeError(err);
  }

  // --- 4. category_bids fallback.
  let categoryBids: unknown = null;
  let categoryBidsError: unknown = null;
  try {
    const rows = (await customer.query(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign.local_services_campaign_settings.category_bids
      FROM campaign
      WHERE campaign.advertising_channel_type = 'LOCAL_SERVICES'
    `)) as Array<Record<string, unknown>>;
    categoryBids = { rowCount: rows.length, rows };
  } catch (err) {
    categoryBidsError = describeError(err);
  }

  // --- 5. Are the two id sets comparable?
  const uniqLeadSvc = Array.from(new Set(leadServiceIds));
  const uniqCritSvc = Array.from(new Set(criterionServiceIds));
  const overlap = uniqLeadSvc.filter((x) => uniqCritSvc.includes(x));
  const comparability = {
    leadServiceIdShapes: Array.from(new Set(uniqLeadSvc.map(shapeOf))),
    criterionServiceIdShapes: Array.from(new Set(uniqCritSvc.map(shapeOf))),
    distinctLeadServiceIds: uniqLeadSvc.length,
    distinctCriterionServiceIds: uniqCritSvc.length,
    overlapCount: overlap.length,
    overlapSample: overlap.slice(0, 20),
    leadOnlySample: uniqLeadSvc.filter((x) => !uniqCritSvc.includes(x)).slice(0, 20),
    criterionOnlySample: uniqCritSvc.filter((x) => !uniqLeadSvc.includes(x)).slice(0, 20),
    // The thing the snapshot match actually depends on: same shape AND real
    // overlap. Same shape with zero overlap would mean the ids are
    // comparable in form but drawn from different namespaces.
    verdict:
      uniqCritSvc.length === 0
        ? "no criterion service ids returned — cannot compare"
        : overlap.length > 0
          ? "comparable: shapes match and ids overlap"
          : "SAME SHAPE BUT NO OVERLAP — likely different id namespaces",
  };

  return NextResponse.json({
    client: {
      name: client.name,
      customerId: client.googleAdsCustomerId,
      loginCustomerId: client.loginCustomerId,
    },
    window: { fromDate, toDate, days },
    q1_campaignCriterion: criteria ?? { error: criteriaError },
    q2q3_leads: leads ?? { error: leadsError },
    q4_categoryBids: categoryBids ?? { error: categoryBidsError },
    q5_comparability: comparability,
  });
}
