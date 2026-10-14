import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { lsaClients, lsaLeadRatingSubmissions } from "@/lib/db/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

// READ-ONLY read-back of the submission audit trail. SELECT only — this
// route never writes and never calls Google.
//
// It exists because ProvideLeadFeedback is write-only with no read-back, so
// lsa_lead_rating_submissions is the single record of what was actually
// sent. Without this, answering "which leads were rated, when" needed a
// direct SQL query against the database.
//
// Not registered in vercel.json: triggered by hand, like the other
// diagnostic routes.
//
// Usage: ?status=ok[&client=<name substring>][&limit=200]
export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const clientFilter = url.searchParams.get("client")?.toLowerCase() ?? null;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "200") || 200, 1000);

  const rows = await db
    .select({
      submission: lsaLeadRatingSubmissions,
      clientName: lsaClients.name,
    })
    .from(lsaLeadRatingSubmissions)
    .innerJoin(lsaClients, eq(lsaClients.id, lsaLeadRatingSubmissions.lsaClientId))
    .where(status ? eq(lsaLeadRatingSubmissions.status, status) : undefined)
    .orderBy(desc(lsaLeadRatingSubmissions.submittedAt))
    .limit(limit);

  const filtered = clientFilter
    ? rows.filter((r) => r.clientName.toLowerCase().includes(clientFilter))
    : rows;

  return NextResponse.json({
    readOnly: true,
    sentToGoogle: false,
    rowCount: filtered.length,
    rows: filtered.map((r) => ({
      client: r.clientName,
      leadId: r.submission.leadId,
      leadResourceName: r.submission.leadResourceName,
      surveyAnswer: r.submission.surveyAnswer,
      dissatisfiedReason: r.submission.dissatisfiedReason,
      status: r.submission.status,
      submittedAt: r.submission.submittedAt,
      errorMessage: r.submission.errorMessage,
      requestPayload: r.submission.requestPayload,
    })),
  });
}
