// Dry run for automated LSA lead rating. NOTHING in this file calls
// ProvideLeadFeedback — it records what would be submitted so the proposed
// ratings can be checked against what the intake team would have chosen.
//
// Evidence per lead:
//   - message leads: the customer's own text only (participant_type 3).
//     Roughly half of message rows are the firm's auto-reply, and a
//     classifier reading those is mostly reading a template back to itself.
//   - call leads: the CallRail transcription of the matching call. Google's
//     own recording URLs sit behind a sign-in wall and are not fetchable.
//
// The join is TIME, not phone number: Google masks the caller's number in
// contact_details (it arrives with a phone_number_extension and never
// equals CallRail's caller id). Matching is scoped to the client's OWN LSA
// trackers, because sibling LSA clients share one CallRail company and
// would otherwise cross-attribute each other's calls.
import { and, eq } from "drizzle-orm";
import { db } from "./db/client";
import { lsaClients, lsaLeadRatingDryRuns, oauthCredentials } from "./db/schema";
import { decryptString } from "./crypto";
import { getCustomer } from "./google-ads";
import { matchesAnyFilter } from "./callrail";
import { generateJson, GEMINI_MODEL } from "./gemini";

export const MATCH_WINDOW_SECONDS = 60;

export type NotJudgedReason =
  | "no_conversation"
  | "no_customer_message"
  | "no_matching_call"
  | "no_transcription"
  | "ambiguous_match"
  | "model_error"
  | "model_unparseable";

export type DryRunCounts = {
  unratedLeads: number;
  judged: number;
  charged: number;
  uncharged: number;
  chargedUnknown: number;
  notJudged: Record<string, number>;
  byAnswer: Record<string, number>;
};

const VALID_ANSWERS = new Set([
  "VERY_SATISFIED",
  "SATISFIED",
  "NEUTRAL",
  "DISSATISFIED",
  "VERY_DISSATISFIED",
]);
const VALID_REASONS = new Set([
  "OTHER_DISSATISFIED_REASON",
  "GEO_MISMATCH",
  "JOB_TYPE_MISMATCH",
  "NOT_READY_TO_BOOK",
  "SPAM",
  "DUPLICATE",
  "SOLICITATION",
]);

export type Verdict = {
  answer: string;
  dissatisfiedReason: string | null;
  reasoning: string;
};

// Parses the model's JSON reply, rejecting anything that isn't a value the
// API would actually accept. A hallucinated enum must surface as
// "model_unparseable", never as a rating we'd later submit.
export function parseVerdict(raw: string): Verdict | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      obj = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const answer = String(o.answer ?? "").toUpperCase();
  if (!VALID_ANSWERS.has(answer)) return null;
  let reason: string | null = null;
  const rawReason = o.dissatisfied_reason ?? o.dissatisfiedReason;
  if (rawReason != null && String(rawReason).toUpperCase() !== "NONE") {
    const r = String(rawReason).toUpperCase();
    if (!VALID_REASONS.has(r)) return null;
    reason = r;
  }
  // A dissatisfied verdict without a reason is not actionable, and a reason
  // attached to a satisfied verdict is contradictory — reject both rather
  // than submitting something incoherent later.
  const dissatisfied = answer === "DISSATISFIED" || answer === "VERY_DISSATISFIED";
  if (dissatisfied && !reason) return null;
  if (!dissatisfied && reason) return null;
  return {
    answer,
    dissatisfiedReason: reason,
    reasoning: String(o.reasoning ?? "").slice(0, 1000),
  };
}

const SYSTEM_INSTRUCTION = `You rate Local Services Ads leads for a law firm, from what the person actually wanted.

Return ONLY JSON: {"answer": <ANSWER>, "dissatisfied_reason": <REASON or null>, "reasoning": "<one or two sentences>"}

ANSWER is one of VERY_SATISFIED, SATISFIED, NEUTRAL, DISSATISFIED, VERY_DISSATISFIED.
REASON is required when the answer is DISSATISFIED or VERY_DISSATISFIED, and must be null otherwise.
REASON is one of GEO_MISMATCH, JOB_TYPE_MISMATCH, NOT_READY_TO_BOOK, SPAM, DUPLICATE, SOLICITATION, OTHER_DISSATISFIED_REASON.

Guidance:
- A genuine prospective client describing a matter the firm handles: SATISFIED, or VERY_SATISFIED when they clearly want to proceed.
- Someone selling something to the firm: VERY_DISSATISFIED with SOLICITATION.
- Robocall, silence, or nonsense: VERY_DISSATISFIED with SPAM.
- An existing client checking on their case, or an obvious repeat of an earlier contact: DISSATISFIED with DUPLICATE.
- A real person whose matter is a case type this firm does not handle: DISSATISFIED with JOB_TYPE_MISMATCH.
- Outside the firm's service area: DISSATISFIED with GEO_MISMATCH.
- Genuine but only enquiring, not ready to engage: NEUTRAL, or DISSATISFIED with NOT_READY_TO_BOOK if they say so.
- If the evidence is too thin to tell, answer NEUTRAL and say so in the reasoning. Do not guess.`;

export type LeadEvidence = {
  leadId: string;
  createdAt: string;
  leadType: string | null;
  leadStatus: string | null;
  leadCharged: boolean | null;
  serviceId: string | null;
  categoryId: string | null;
  source: "message" | "call_transcript" | null;
  text: string | null;
  notJudged: NotJudgedReason | null;
};

function epochLocal(s: string): number | null {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000;
}

type CallRow = {
  startTime: string;
  transcription: string | null;
  trackerName: string;
  firstCall: boolean;
  consumed?: boolean;
};

// Picks the single best call for a lead: nearest in time within the window,
// preferring a first_call and an untaken row. Each call is consumed once —
// a repeat caller who redials within a minute must not have both calls
// claimed by the same lead (a real case: two calls 48s apart, same number).
export function selectCallForLead(
  leadEpoch: number,
  calls: CallRow[],
  windowSec = MATCH_WINDOW_SECONDS,
): { call: CallRow | null; ambiguous: boolean } {
  const inWindow = calls.filter((c) => {
    if (c.consumed) return false;
    const t = epochLocal(c.startTime);
    return t !== null && Math.abs(t - leadEpoch) <= windowSec;
  });
  if (inWindow.length === 0) return { call: null, ambiguous: false };
  const scored = inWindow
    .map((c) => ({ c, d: Math.abs((epochLocal(c.startTime) as number) - leadEpoch) }))
    .sort((a, b) => {
      if (a.c.firstCall !== b.c.firstCall) return a.c.firstCall ? -1 : 1;
      return a.d - b.d;
    });
  // Ambiguous only when two candidates are equally good on both signals —
  // otherwise first_call plus proximity resolves it.
  const ambiguous =
    scored.length > 1 &&
    scored[0].c.firstCall === scored[1].c.firstCall &&
    scored[0].d === scored[1].d;
  scored[0].c.consumed = true;
  return { call: scored[0].c, ambiguous };
}

export function emptyCounts(): DryRunCounts {
  return {
    unratedLeads: 0,
    judged: 0,
    charged: 0,
    uncharged: 0,
    chargedUnknown: 0,
    notJudged: {},
    byAnswer: {},
  };
}

export async function runLeadRatingDryRun(
  lsaClientId: string,
  opts: { fromDate: string; toDate: string; limit?: number },
): Promise<{ counts: DryRunCounts; errors: string[] }> {
  const counts = emptyCounts();
  const errors: string[] = [];

  const client = await db.query.lsaClients.findFirst({
    where: eq(lsaClients.id, lsaClientId),
  });
  if (!client?.googleAdsCustomerId || !client.googleAdsOauthTokenId) {
    return { counts, errors: ["client not linked to Google Ads"] };
  }
  const cred = await db.query.oauthCredentials.findFirst({
    where: eq(oauthCredentials.id, client.googleAdsOauthTokenId),
  });
  if (!cred) return { counts, errors: ["oauth credential missing"] };

  const customer = getCustomer(
    decryptString(cred.refreshTokenEncrypted),
    client.googleAdsCustomerId,
    client.loginCustomerId ?? undefined,
  );

  // --- Unrated leads in range.
  const leadRows = (await customer.query(`
    SELECT
      local_services_lead.id,
      local_services_lead.lead_type,
      local_services_lead.lead_status,
      local_services_lead.lead_charged,
      local_services_lead.lead_feedback_submitted,
      local_services_lead.service_id,
      local_services_lead.category_id,
      local_services_lead.creation_date_time
    FROM local_services_lead
    WHERE local_services_lead.creation_date_time BETWEEN '${opts.fromDate} 00:00:00' AND '${opts.toDate} 23:59:59'
  `)) as Array<Record<string, unknown>>;

  const unrated = leadRows
    .map((r) => (r.local_services_lead ?? {}) as Record<string, unknown>)
    .filter((l) => l.lead_feedback_submitted !== true)
    .slice(0, opts.limit ?? 200);
  counts.unratedLeads = unrated.length;
  if (unrated.length === 0) return { counts, errors };

  // --- Customer messages for those leads.
  const messageByLead = new Map<string, string[]>();
  try {
    const resources = unrated.map((l) => String(l.resource_name)).filter(Boolean);
    for (let i = 0; i < resources.length; i += 40) {
      const inList = resources.slice(i, i + 40).map((r) => `'${r}'`).join(",");
      const rows = (await customer.query(`
        SELECT
          local_services_lead_conversation.lead,
          local_services_lead_conversation.participant_type,
          local_services_lead_conversation.message_details.text
        FROM local_services_lead_conversation
        WHERE local_services_lead_conversation.lead IN (${inList})
      `)) as Array<Record<string, unknown>>;
      for (const r of rows) {
        const c = (r.local_services_lead_conversation ?? {}) as {
          lead?: string;
          participant_type?: unknown;
          message_details?: { text?: string } | null;
        };
        // participant_type 3 === the consumer. Type 2 is the firm's own
        // auto-reply and must never be read as the customer's intent.
        if (c.participant_type !== 3) continue;
        const text = c.message_details?.text;
        if (!c.lead || !text) continue;
        const arr = messageByLead.get(c.lead) ?? [];
        arr.push(text);
        messageByLead.set(c.lead, arr);
      }
    }
  } catch (err) {
    errors.push(`conversation pull: ${err instanceof Error ? err.message : String(err)}`);
  }

  // --- CallRail calls on THIS client's own LSA trackers.
  const calls: CallRow[] = [];
  const filters = client.signedCaseNameFilters.map((f) => f.trim().toLowerCase()).filter(Boolean);
  if (client.callrailCompanyId && filters.length > 0) {
    try {
      const fetched = await fetchCallrailCalls(
        client.callrailCompanyId,
        opts.fromDate,
        opts.toDate,
      );
      for (const c of fetched) {
        const tracker = String(c.source_name ?? "").toLowerCase();
        if (!matchesAnyFilter(tracker, filters)) continue;
        if (c.direction !== "inbound") continue;
        calls.push({
          startTime: String(c.start_time ?? ""),
          transcription: (c.transcription as string | null) ?? null,
          trackerName: String(c.source_name ?? ""),
          firstCall: c.first_call === true,
        });
      }
    } catch (err) {
      errors.push(`callrail: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // --- Build evidence, classify, record.
  for (const l of unrated) {
    const charged = l.lead_charged;
    if (charged === true) counts.charged += 1;
    else if (charged === false) counts.uncharged += 1;
    else counts.chargedUnknown += 1;

    const ev = buildEvidence(l, messageByLead, calls);
    let verdict: Verdict | null = null;
    let notJudged: string | null = ev.notJudged;

    if (!notJudged && ev.text) {
      const res = await generateJson(SYSTEM_INSTRUCTION, buildPrompt(l, ev));
      if (!res.ok) {
        notJudged = "model_error";
        errors.push(`lead ${ev.leadId}: ${res.error}`.slice(0, 200));
      } else {
        verdict = parseVerdict(res.text);
        if (!verdict) notJudged = "model_unparseable";
      }
    }

    if (verdict) {
      counts.judged += 1;
      counts.byAnswer[verdict.answer] = (counts.byAnswer[verdict.answer] ?? 0) + 1;
    } else if (notJudged) {
      counts.notJudged[notJudged] = (counts.notJudged[notJudged] ?? 0) + 1;
    }

    await db
      .insert(lsaLeadRatingDryRuns)
      .values({
        lsaClientId,
        leadId: ev.leadId,
        leadCreatedAt: ev.createdAt ? new Date(`${ev.createdAt.replace(" ", "T")}Z`) : null,
        leadType: ev.leadType,
        leadStatus: ev.leadStatus,
        leadCharged: typeof charged === "boolean" ? charged : null,
        serviceId: ev.serviceId,
        categoryId: ev.categoryId,
        evidenceSource: verdict ? ev.source : null,
        evidenceExcerpt: ev.text ? ev.text.slice(0, 500) : null,
        proposedAnswer: verdict?.answer ?? null,
        proposedDissatisfiedReason: verdict?.dissatisfiedReason ?? null,
        modelReasoning: verdict?.reasoning ?? null,
        notJudgedReason: verdict ? null : notJudged,
        model: GEMINI_MODEL,
      })
      .onConflictDoUpdate({
        target: [lsaLeadRatingDryRuns.lsaClientId, lsaLeadRatingDryRuns.leadId],
        set: {
          evidenceSource: verdict ? ev.source : null,
          evidenceExcerpt: ev.text ? ev.text.slice(0, 500) : null,
          proposedAnswer: verdict?.answer ?? null,
          proposedDissatisfiedReason: verdict?.dissatisfiedReason ?? null,
          modelReasoning: verdict?.reasoning ?? null,
          notJudgedReason: verdict ? null : notJudged,
          model: GEMINI_MODEL,
          createdAt: new Date(),
        },
      });
  }

  return { counts, errors };
}

function buildEvidence(
  l: Record<string, unknown>,
  messageByLead: Map<string, string[]>,
  calls: CallRow[],
): LeadEvidence {
  const base: LeadEvidence = {
    leadId: String(l.id ?? ""),
    createdAt: String(l.creation_date_time ?? ""),
    leadType: l.lead_type != null ? String(l.lead_type) : null,
    leadStatus: l.lead_status != null ? String(l.lead_status) : null,
    leadCharged: typeof l.lead_charged === "boolean" ? l.lead_charged : null,
    serviceId: (l.service_id as string | null) ?? null,
    categoryId: (l.category_id as string | null) ?? null,
    source: null,
    text: null,
    notJudged: null,
  };

  const msgs = messageByLead.get(String(l.resource_name ?? "")) ?? [];
  if (msgs.length > 0) {
    return { ...base, source: "message", text: msgs.join("\n") };
  }

  const leadEpoch = epochLocal(base.createdAt);
  if (leadEpoch === null) return { ...base, notJudged: "no_conversation" };

  const { call, ambiguous } = selectCallForLead(leadEpoch, calls);
  if (ambiguous) return { ...base, notJudged: "ambiguous_match" };
  if (!call) return { ...base, notJudged: "no_matching_call" };
  if (!call.transcription) return { ...base, notJudged: "no_transcription" };
  return { ...base, source: "call_transcript", text: call.transcription };
}

function buildPrompt(l: Record<string, unknown>, ev: LeadEvidence): string {
  return [
    `Lead service: ${ev.serviceId ?? "(none recorded)"}`,
    `Lead category: ${ev.categoryId ?? "(none recorded)"}`,
    `Evidence type: ${ev.source === "message" ? "customer message(s)" : "call transcript"}`,
    "",
    ev.source === "message"
      ? "Customer's own message(s):"
      : "Transcript (Agent = the firm, Caller = the person):",
    ev.text ?? "",
  ].join("\n");
}

const CALLRAIL_BASE = process.env.CALLRAIL_API_BASE ?? "https://api.callrail.com";

async function fetchCallrailCalls(
  companyId: string,
  fromDate: string,
  toDate: string,
): Promise<Array<Record<string, unknown>>> {
  const key = process.env.CALLRAIL_API_KEY;
  if (!key) throw new Error("CALLRAIL_API_KEY not set");
  const headers = { Authorization: `Token token="${key}"`, "Content-Type": "application/json" };
  let accountId = process.env.CALLRAIL_ACCOUNT_ID;
  if (!accountId) {
    const res = await fetch(`${CALLRAIL_BASE}/v3/a.json`, { headers });
    if (!res.ok) throw new Error(`accounts ${res.status}`);
    const body = (await res.json()) as { accounts?: Array<{ id: string }> };
    accountId = body.accounts?.[0]?.id;
    if (!accountId) throw new Error("no CallRail account");
  }
  const out: Array<Record<string, unknown>> = [];
  for (let page = 1; page <= 40; page += 1) {
    const u = new URL(`${CALLRAIL_BASE}/v3/a/${accountId}/calls.json`);
    u.searchParams.set("company_id", companyId);
    u.searchParams.set("per_page", "250");
    u.searchParams.set("page", String(page));
    u.searchParams.set("start_date", fromDate);
    u.searchParams.set("end_date", toDate);
    u.searchParams.set("fields", "source_name,direction,transcription,first_call,duration");
    const res = await fetch(u.toString(), { headers });
    if (!res.ok) throw new Error(`calls ${res.status}`);
    const body = (await res.json()) as {
      calls?: Array<Record<string, unknown>>;
      total_pages?: number;
    };
    for (const c of body.calls ?? []) out.push(c);
    if (!body.total_pages || page >= body.total_pages) break;
  }
  return out;
}

export async function listDryRunClients(): Promise<Array<{ id: string; name: string }>> {
  const rows = await db.query.lsaClients.findMany({
    where: and(eq(lsaClients.isActive, true)),
    columns: { id: true, name: true },
  });
  return rows;
}
