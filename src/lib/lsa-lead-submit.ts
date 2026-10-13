// Submission of LSA lead ratings to Google via
// LocalServicesLeadService.ProvideLeadFeedback.
//
// That API is WRITE-ONLY: there is no read-back and no way to revise a
// rating once sent. Every guard here exists because a mistake is permanent.
//
//   1. Kill switch   — LSA_LEAD_RATING_SUBMIT env var, OFF unless exactly
//                      "true". Nothing reaches Google without it.
//   2. Allowlist     — lsa_clients.lead_rating_enabled, false by default,
//                      so widening is a config change not a deploy.
//   3. Daily cap     — per client, bounds the blast radius of a bad run.
//   4. Re-read       — lead_feedback_submitted is re-read from Google
//                      immediately before submitting, so a lead the intake
//                      team rated since the scan is never overwritten.
//   5. Audit-first   — the audit row is INSERTED BEFORE the API call, with
//                      a unique index on lead_id. A crash between the call
//                      and the write cannot produce a second submission.
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "./db/client";
import {
  lsaClients,
  lsaLeadRatingSubmissions,
  oauthCredentials,
  type LsaClient,
} from "./db/schema";
import { decryptString } from "./crypto";
import { getCustomer } from "./google-ads";

export function submissionEnabled(): boolean {
  return process.env.LSA_LEAD_RATING_SUBMIT === "true";
}

export function dailyCapPerClient(): number {
  const n = Number(process.env.LSA_LEAD_RATING_DAILY_CAP ?? "25");
  return Number.isFinite(n) && n > 0 ? n : 25;
}

export type SubmitOutcome =
  | { sent: true }
  | {
      sent: false;
      reason:
        | "kill_switch_off"
        | "client_not_allowlisted"
        | "daily_cap_reached"
        | "already_rated_at_google"
        | "already_submitted"
        | "lead_not_found"
        | "api_error";
      detail?: string;
    };

// Live re-read of this one lead straight from Google. Deliberately not the
// value captured during the scan: the intake team may have rated it in the
// minutes since, and overwriting their judgement is the thing this must
// never do.
async function isAlreadyRatedAtGoogle(
  client: LsaClient,
  refreshToken: string,
  leadResourceName: string,
): Promise<boolean | null> {
  try {
    const customer = getCustomer(
      refreshToken,
      client.googleAdsCustomerId!,
      client.loginCustomerId ?? undefined,
    );
    const rows = (await customer.query(`
      SELECT local_services_lead.id, local_services_lead.lead_feedback_submitted
      FROM local_services_lead
      WHERE local_services_lead.resource_name = '${leadResourceName}'
    `)) as Array<Record<string, unknown>>;
    if (rows.length === 0) return null;
    const l = (rows[0].local_services_lead ?? {}) as Record<string, unknown>;
    return l.lead_feedback_submitted === true;
  } catch {
    // Unknown is not "no". Fail closed.
    return null;
  }
}

export async function submitLeadRating(args: {
  client: LsaClient;
  leadId: string;
  leadResourceName: string;
  surveyAnswer: string;
  dissatisfiedReason: string | null;
}): Promise<SubmitOutcome> {
  const { client, leadId, leadResourceName, surveyAnswer, dissatisfiedReason } = args;

  if (!submissionEnabled()) return { sent: false, reason: "kill_switch_off" };
  if (!client.leadRatingEnabled) return { sent: false, reason: "client_not_allowlisted" };
  if (!client.googleAdsCustomerId || !client.googleAdsOauthTokenId) {
    return { sent: false, reason: "lead_not_found", detail: "client not linked to Google Ads" };
  }

  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(lsaLeadRatingSubmissions)
    .where(
      and(
        eq(lsaLeadRatingSubmissions.lsaClientId, client.id),
        eq(lsaLeadRatingSubmissions.status, "ok"),
        gte(lsaLeadRatingSubmissions.submittedAt, since),
      ),
    );
  if (count >= dailyCapPerClient()) return { sent: false, reason: "daily_cap_reached" };

  const cred = await db.query.oauthCredentials.findFirst({
    where: eq(oauthCredentials.id, client.googleAdsOauthTokenId),
  });
  if (!cred) return { sent: false, reason: "lead_not_found", detail: "oauth credential missing" };
  const refreshToken = decryptString(cred.refreshTokenEncrypted);

  const rated = await isAlreadyRatedAtGoogle(client, refreshToken, leadResourceName);
  if (rated === null) {
    return { sent: false, reason: "lead_not_found", detail: "could not re-read lead" };
  }
  if (rated) return { sent: false, reason: "already_rated_at_google" };

  const payload: Record<string, unknown> = {
    resource_name: leadResourceName,
    survey_answer: surveyAnswer,
  };
  if (dissatisfiedReason) {
    payload.survey_dissatisfied = { reason: dissatisfiedReason };
  }

  // Claim the lead BEFORE calling Google. If this insert conflicts, another
  // run already submitted (or is submitting) this lead.
  const claimed = await db
    .insert(lsaLeadRatingSubmissions)
    .values({
      lsaClientId: client.id,
      leadId,
      leadResourceName,
      surveyAnswer,
      dissatisfiedReason,
      requestPayload: payload,
      status: "pending",
    })
    .onConflictDoNothing({ target: lsaLeadRatingSubmissions.leadId })
    .returning();
  if (claimed.length === 0) return { sent: false, reason: "already_submitted" };

  try {
    const customer = getCustomer(
      refreshToken,
      client.googleAdsCustomerId,
      client.loginCustomerId ?? undefined,
    );
    const res = await (
      customer as unknown as {
        localsLeadServices: {
          provideLeadFeedback: (r: unknown) => Promise<unknown>;
        };
      }
    ).localsLeadServices.provideLeadFeedback(payload);
    await db
      .update(lsaLeadRatingSubmissions)
      .set({ status: "ok", responseBody: JSON.stringify(res ?? {}).slice(0, 2000) })
      .where(eq(lsaLeadRatingSubmissions.id, claimed[0].id));
    return { sent: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err).slice(0, 1000);
    await db
      .update(lsaLeadRatingSubmissions)
      .set({ status: "failed", errorMessage: msg.slice(0, 2000) })
      .where(eq(lsaLeadRatingSubmissions.id, claimed[0].id));
    return { sent: false, reason: "api_error", detail: msg.slice(0, 300) };
  }
}

// Clients eligible for the round-robin scan, least-recently-scanned first.
export async function clientsDueForScan(batchSize: number): Promise<LsaClient[]> {
  return db.query.lsaClients.findMany({
    where: and(eq(lsaClients.isActive, true)),
    // Raw fragment, NOT asc(sql`... nulls first`): wrapping it in asc()
    // emitted "nulls first asc", which Postgres rejects — the whole route
    // 500'd on every run. NULLS FIRST must follow the direction.
    orderBy: () => [sql`${lsaClients.lastRatedScanAt} asc nulls first`],
    limit: batchSize,
  });
}

export async function markScanned(lsaClientId: string): Promise<void> {
  await db
    .update(lsaClients)
    .set({ lastRatedScanAt: new Date() })
    .where(eq(lsaClients.id, lsaClientId));
}
