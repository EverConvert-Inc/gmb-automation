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
import type { services } from "google-ads-api";
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

// How many times one lead may ever be attempted, counting failures. Bounds
// a permanently-rejected lead so it can't re-attempt every 10 minutes forever.
export function maxAttemptsPerLead(): number {
  const n = Number(process.env.LSA_LEAD_RATING_MAX_ATTEMPTS ?? "3");
  return Number.isFinite(n) && n > 0 ? n : 3;
}

// Field names come from the generated request interface, so a misspelled key
// is a compile error. This matters more than it looks: protobuf's fromObject
// SILENTLY DROPS unknown keys. Sending `{ reason: "JOB_TYPE_MISMATCH" }`
// instead of `{ survey_dissatisfied_reason: ... }` produced a well-formed
// request whose required enum defaulted to 0, and Google rejected every one
// with "Enum value UNSPECIFIED cannot be used". Nothing failed locally.
type FeedbackRequest = services.IProvideLeadFeedbackRequest;
type SurveyAnswerName = NonNullable<FeedbackRequest["survey_answer"]>;
type DissatisfiedReasonName = NonNullable<
  NonNullable<FeedbackRequest["survey_dissatisfied"]>["survey_dissatisfied_reason"]
>;
type SatisfiedReasonName = NonNullable<
  NonNullable<FeedbackRequest["survey_satisfied"]>["survey_satisfied_reason"]
>;

// The satisfied branch mirrors the rating rule: a lead counts as satisfied
// because it asked for a service the client had enabled that day — which is
// what SERVICE_RELATED means — even where the firm declined it on the call.
const SATISFIED_REASON: SatisfiedReasonName = "SERVICE_RELATED";

export function buildFeedbackPayload(args: {
  leadResourceName: string;
  surveyAnswer: string;
  dissatisfiedReason: string | null;
}): FeedbackRequest {
  const payload: FeedbackRequest = {
    resource_name: args.leadResourceName,
    survey_answer: args.surveyAnswer as SurveyAnswerName,
  };
  // survey_details is a oneof — exactly one side may be set, never both.
  if (args.dissatisfiedReason) {
    payload.survey_dissatisfied = {
      survey_dissatisfied_reason: args.dissatisfiedReason as DissatisfiedReasonName,
    };
  } else {
    payload.survey_satisfied = { survey_satisfied_reason: SATISFIED_REASON };
  }
  return payload;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

// Google's real rejection lives in the GoogleAdsFailure attached to the
// error, not in err.message — which is often just "Request contains an
// invalid argument." Flatten everything so the failure is readable without
// a database query.
export function describeGoogleAdsError(err: unknown): string {
  // Primitives read better raw than JSON-quoted in a log line.
  if (!err || typeof err !== "object") return String(err);
  const e = err as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof e.message === "string" && e.message) parts.push(e.message);
  if (Array.isArray(e.errors) && e.errors.length > 0) {
    parts.push(`google_ads_failure=${safeJson(e.errors)}`);
  }
  if (e.code !== undefined) parts.push(`code=${String(e.code)}`);
  if (typeof e.request_id === "string") parts.push(`request_id=${e.request_id}`);
  if (typeof e.details === "string" && e.details) parts.push(`details=${e.details}`);
  return parts.length > 0 ? parts.join(" | ") : safeJson(e);
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
        | "retry_cap_reached"
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

  const payload = buildFeedbackPayload({
    leadResourceName,
    surveyAnswer,
    dissatisfiedReason,
  });

  // Every prior row for this lead counts as an attempt, failures included.
  const [{ attempts }] = await db
    .select({ attempts: sql<number>`count(*)::int` })
    .from(lsaLeadRatingSubmissions)
    .where(eq(lsaLeadRatingSubmissions.leadId, leadId));
  if (attempts >= maxAttemptsPerLead()) {
    return {
      sent: false,
      reason: "retry_cap_reached",
      detail: `${attempts} prior attempt(s)`,
    };
  }

  // Claim the lead BEFORE calling Google. The conflict target is the partial
  // unique index, so a live (pending/ok) row blocks absolutely while a failed
  // row leaves the lead retryable.
  const claimed = await db
    .insert(lsaLeadRatingSubmissions)
    .values({
      lsaClientId: client.id,
      leadId,
      leadResourceName,
      surveyAnswer,
      dissatisfiedReason,
      requestPayload: payload as Record<string, unknown>,
      status: "pending",
    })
    // `where` here is the partial index's predicate, which Postgres needs to
    // match the conflict target to the partial unique index.
    .onConflictDoNothing({
      target: lsaLeadRatingSubmissions.leadId,
      where: sql`${lsaLeadRatingSubmissions.status} <> 'failed'`,
    })
    .returning();
  if (claimed.length === 0) return { sent: false, reason: "already_submitted" };

  try {
    const customer = getCustomer(
      refreshToken,
      client.googleAdsCustomerId,
      client.loginCustomerId ?? undefined,
    );
    // Pass the PLAIN object. Two things make this deliberate:
    //
    //  - `new services.ProvideLeadFeedbackRequest(payload)` assigns string
    //    enum names verbatim without converting them, so encode() writes 0 —
    //    it turns both survey_answer AND the reason into UNSPECIFIED. Using
    //    the constructor here would have reproduced the original outage.
    //  - The library converts a plain object itself (fromObject), which is
    //    the path already proven end-to-end against the live API.
    //
    // The cast is only to the request class the signature names; `payload` is
    // typed as the generated interface above, so every field name is still
    // compiler-checked. That is what the removed `as unknown as` cast killed.
    const res = await customer.localsLeadServices.provideLeadFeedback(
      payload as services.ProvideLeadFeedbackRequest,
    );
    await db
      .update(lsaLeadRatingSubmissions)
      .set({ status: "ok", responseBody: JSON.stringify(res ?? {}).slice(0, 2000) })
      .where(eq(lsaLeadRatingSubmissions.id, claimed[0].id));
    return { sent: true };
  } catch (err) {
    const msg = describeGoogleAdsError(err);
    await db
      .update(lsaLeadRatingSubmissions)
      .set({ status: "failed", errorMessage: msg.slice(0, 4000) })
      .where(eq(lsaLeadRatingSubmissions.id, claimed[0].id));
    // Full text, not a 300-char slice: the cron route reports this straight
    // back in its JSON so the failure is readable without a SQL query.
    return { sent: false, reason: "api_error", detail: msg.slice(0, 4000) };
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
