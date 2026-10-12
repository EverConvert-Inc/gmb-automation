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
import {
  lsaClients,
  lsaLeadRatingDryRuns,
  lsaServiceSnapshots,
  oauthCredentials,
} from "./db/schema";
import { decryptString } from "./crypto";
import { getCustomer } from "./google-ads";
import { matchesAnyFilter } from "./callrail";
import { generateJson, GEMINI_MODEL } from "./gemini";
import { pullLocalServiceCriteria } from "./google-ads";
import { todayIsoEastern } from "./date-utils";

export const MATCH_WINDOW_SECONDS = 60;

// A call may still be in progress, and CallRail transcripts land roughly a
// minute after a call ends — so these are "not ready yet", not "no".
export const RETRYABLE_REASONS = new Set<string>(["no_matching_call", "no_transcription"]);
// Give up after this many attempts: a call that never produced a transcript
// will not suddenly produce one, and retrying forever costs Gemini nothing
// but costs CallRail and Google Ads calls every run.
export const MAX_ATTEMPTS = 6;
export function backoffMinutes(attempt: number): number {
  return Math.min(60, 2 ** Math.max(0, attempt - 1) * 2);
}

export type NotJudgedReason =
  | "no_conversation"
  | "no_customer_message"
  | "no_matching_call"
  | "no_transcription"
  | "ambiguous_match"
  | "no_service_snapshot"
  | "service_unclear"
  | "model_error"
  | "model_unparseable";

// A verdict ready for submission. Carries the lead's resource name because
// ProvideLeadFeedback is keyed on it, not on the numeric id.
export type JudgedLead = {
  leadId: string;
  leadResourceName: string;
  answer: string;
  dissatisfiedReason: string | null;
};

export type DryRunCounts = {
  unratedLeads: number;
  judged: number;
  // Leads already settled by an earlier run (verdict recorded, terminally
  // unjudgeable, out of attempts, or still inside their retry backoff).
  skippedExisting: number;
  charged: number;
  uncharged: number;
  chargedUnknown: number;
  notJudged: Record<string, number>;
  byAnswer: Record<string, number>;
};

const VALID_CLASSIFICATIONS = new Set([
  "GENUINE",
  "SPAM",
  "SOLICITATION",
  "DUPLICATE",
  "NOT_READY_TO_BOOK",
]);

export type Classification = {
  requestedService: string;
  classification: string;
  // Whether the conversation meets this client's own definition of a
  // genuine lead. Only consulted when requestedService is UNKNOWN — the
  // enabled-services list always wins when the service is identifiable.
  meetsClientDefinition: boolean;
  // True when the model fell back on Google's own service_id/category_id
  // label because the conversation alone didn't identify the service.
  usedLabelHint: boolean;
  reasoning: string;
};

// The model identifies WHAT the person wanted and whether the contact was
// genuine. It does NOT choose the rating — that rule is applied in code
// below, so it stays auditable and consistent rather than depending on the
// model's judgement of our business rules.
export function parseClassification(raw: string): Classification | null {
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
  const classification = String(o.classification ?? "").toUpperCase();
  if (!VALID_CLASSIFICATIONS.has(classification)) return null;
  const requestedService = String(o.requested_service ?? o.requestedService ?? "").trim();
  if (!requestedService) return null;
  const meets = o.meets_client_definition ?? o.meetsClientDefinition;
  const hint = o.used_label_as_hint ?? o.usedLabelAsHint;
  return {
    requestedService,
    classification,
    meetsClientDefinition: meets === true || String(meets).toLowerCase() === "true",
    usedLabelHint: hint === true || String(hint).toLowerCase() === "true",
    reasoning: String(o.reasoning ?? "").slice(0, 1000),
  };
}

export type RatingDecision = {
  answer: string;
  dissatisfiedReason: string | null;
  serviceWasEnabled: boolean | null;
  notJudged: NotJudgedReason | null;
};

// The rating rule, as the intake team actually applies it:
//   - the service the person asked about was ON at the time -> satisfied,
//     EVEN IF the firm declined the matter on the call. A firm turning
//     down an at-fault accident while auto_accidents was switched on is
//     not a job-type mismatch; the lead was for what was advertised.
//   - the service was NOT on -> dissatisfied + JOB_TYPE_MISMATCH.
//   - spam / solicitation / duplicate / not-ready -> their own reasons,
//     regardless of service.
export function decideRating(
  c: Classification,
  enabledServiceIds: string[],
): RatingDecision {
  switch (c.classification) {
    case "SPAM":
      return { answer: "VERY_DISSATISFIED", dissatisfiedReason: "SPAM", serviceWasEnabled: null, notJudged: null };
    case "SOLICITATION":
      return { answer: "VERY_DISSATISFIED", dissatisfiedReason: "SOLICITATION", serviceWasEnabled: null, notJudged: null };
    case "DUPLICATE":
      return { answer: "DISSATISFIED", dissatisfiedReason: "DUPLICATE", serviceWasEnabled: null, notJudged: null };
    case "NOT_READY_TO_BOOK":
      return { answer: "DISSATISFIED", dissatisfiedReason: "NOT_READY_TO_BOOK", serviceWasEnabled: null, notJudged: null };
  }
  // GENUINE from here: the rating turns on whether the service was on.
  const svc = c.requestedService.toUpperCase();
  if (svc === "UNKNOWN") {
    // The ONLY place the client definition applies. A genuine lead whose
    // subject can't be identified is satisfied if it meets the client's own
    // definition (e.g. a personal-injury firm hearing about an injury),
    // otherwise it stays unjudged rather than guessed.
    return c.meetsClientDefinition
      ? { answer: "SATISFIED", dissatisfiedReason: null, serviceWasEnabled: null, notJudged: null }
      : { answer: "", dissatisfiedReason: null, serviceWasEnabled: null, notJudged: "service_unclear" };
  }
  if (svc === "OTHER_NOT_LISTED") {
    return { answer: "DISSATISFIED", dissatisfiedReason: "JOB_TYPE_MISMATCH", serviceWasEnabled: false, notJudged: null };
  }
  const enabled = enabledServiceIds.includes(c.requestedService);
  return enabled
    ? { answer: "SATISFIED", dissatisfiedReason: null, serviceWasEnabled: true, notJudged: null }
    : { answer: "DISSATISFIED", dissatisfiedReason: "JOB_TYPE_MISMATCH", serviceWasEnabled: false, notJudged: null };
}

function systemInstruction(
  enabledServiceIds: string[],
  qualificationDefinition: string | null,
): string {
  return `You read a Local Services Ads enquiry to a law firm and report TWO things. You do not decide any rating.

The firm had exactly these services switched on when this enquiry arrived:
${enabledServiceIds.map((s) => `- ${s}`).join("\n")}

Return ONLY JSON:
{"requested_service": "<one id from the list above, or OTHER_NOT_LISTED, or UNKNOWN>", "classification": "<GENUINE|SPAM|SOLICITATION|DUPLICATE|NOT_READY_TO_BOOK>", "meets_client_definition": <true|false>, "used_label_as_hint": <true|false>, "reasoning": "<one or two sentences>"}

requested_service: which of the listed services the person was asking about. Use the id exactly as written above. Use OTHER_NOT_LISTED when they clearly wanted a legal matter that is not in the list. Use UNKNOWN when the evidence is too thin to tell.

"Lead service" is Google's label for the lead. If the conversation names the service, use the conversation. If it doesn't, use Google's label.

used_label_as_hint: true when you used Google's label because the conversation did not name the service. False when the conversation itself named it.

meets_client_definition: ${
    qualificationDefinition
      ? `true when the conversation meets this firm's own definition of a genuine lead, false otherwise.\n\nThe firm's definition:\n"""\n${qualificationDefinition}\n"""\n\nJudge this independently of requested_service — it is consulted only when the service cannot be identified.`
      : "always false — this firm has no definition configured."
  }

classification:
- GENUINE: a real prospective client describing their own matter.
- SPAM: robocall, silence, gibberish, or an obvious automated message.
- SOLICITATION: someone selling something TO the firm.
- DUPLICATE: an existing client, or an obvious repeat of an earlier contact.
- NOT_READY_TO_BOOK: genuine, but explicitly not ready to engage.

IMPORTANT: if the firm declines the matter on the call, that does NOT change requested_service. Report what the person asked about. Whether the firm takes it is not your decision.`;
}

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
    skippedExisting: 0,
    charged: 0,
    uncharged: 0,
    chargedUnknown: 0,
    notJudged: {},
    byAnswer: {},
  };
}

export async function runLeadRatingDryRun(
  lsaClientId: string,
  opts: {
    fromDate: string;
    toDate: string;
    limit?: number;
    // "unrated" is the real backlog. "rated" re-classifies leads the intake
    // team has already judged, purely to compare the model against them —
    // kept separate everywhere so the two populations never mix.
    population?: "unrated" | "rated";
  },
): Promise<{ counts: DryRunCounts; errors: string[]; judgedLeads: JudgedLead[] }> {
  const counts = emptyCounts();
  const errors: string[] = [];
  const judgedLeads: JudgedLead[] = [];

  const client = await db.query.lsaClients.findFirst({
    where: eq(lsaClients.id, lsaClientId),
  });
  if (!client?.googleAdsCustomerId || !client.googleAdsOauthTokenId) {
    return { counts, errors: ["client not linked to Google Ads"], judgedLeads };
  }
  const cred = await db.query.oauthCredentials.findFirst({
    where: eq(oauthCredentials.id, client.googleAdsOauthTokenId),
  });
  if (!cred) return { counts, errors: ["oauth credential missing"], judgedLeads };

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

  // Never classify the same lead twice: a lead with a verdict is done, and
  // a retryable one is skipped until its backoff elapses.
  const existing = new Map(
    (
      await db
        .select()
        .from(lsaLeadRatingDryRuns)
        .where(eq(lsaLeadRatingDryRuns.lsaClientId, lsaClientId))
    ).map((r) => [r.leadId, r]),
  );
  const wantRated = opts.population === "rated";
  const unrated = leadRows
    .map((r) => (r.local_services_lead ?? {}) as Record<string, unknown>)
    .filter((l) =>
      wantRated ? l.lead_feedback_submitted === true : l.lead_feedback_submitted !== true,
    )
    .slice(0, opts.limit ?? 200);
  counts.unratedLeads = unrated.length;
  if (unrated.length === 0) return { counts, errors, judgedLeads };

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

  // Today's leads have no snapshot yet — the daily sync writes it for
  // yesterday. Read the criteria LIVE instead, and persist that read as
  // today's snapshot so it becomes history for later runs. Past dates still
  // use the stored snapshot; today's list is never applied to an old lead.
  const today = todayIsoEastern();
  let liveEnabled: string[] | null = null;
  try {
    const criteria = await pullLocalServiceCriteria(
      decryptString(cred.refreshTokenEncrypted),
      client.googleAdsCustomerId,
      client.loginCustomerId ?? undefined,
    );
    const enabledNow = criteria.filter((c) => c.status === "ENABLED" && !c.negative);
    if (enabledNow.length > 0) {
      liveEnabled = enabledNow.map((c) => c.serviceId);
      await db
        .insert(lsaServiceSnapshots)
        .values({
          lsaClientId,
          date: today,
          enabledServiceIds: liveEnabled,
          criteria,
          leadServiceIds: {},
          criteriaAvailable: true,
          capturedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [lsaServiceSnapshots.lsaClientId, lsaServiceSnapshots.date],
          set: {
            enabledServiceIds: liveEnabled,
            criteria,
            criteriaAvailable: true,
            capturedAt: new Date(),
          },
        });
    }
  } catch (err) {
    errors.push(`live criteria: ${err instanceof Error ? err.message : String(err)}`);
  }

  // --- Enabled services AS OF each lead's own date. campaign_criterion
  // only ever returns current state, so today's list says nothing about a
  // lead from last month — that is exactly why the snapshot exists.
  const snapshotByDate = new Map<string, string[]>();
  const snapRows = await db
    .select()
    .from(lsaServiceSnapshots)
    .where(eq(lsaServiceSnapshots.lsaClientId, lsaClientId));
  for (const r of snapRows) {
    if (!r.criteriaAvailable) continue;
    snapshotByDate.set(String(r.date), r.enabledServiceIds);
  }

  // --- Build evidence, classify, record.
  for (const l of unrated) {
    const prior = existing.get(String(l.id ?? ""));
    if (prior) {
      const done = !!prior.proposedAnswer;
      const terminal = !!prior.notJudgedReason && !RETRYABLE_REASONS.has(prior.notJudgedReason);
      const exhausted = prior.attempts >= MAX_ATTEMPTS;
      const waiting = prior.nextAttemptAfter != null && prior.nextAttemptAfter > new Date();
      if (done || terminal || exhausted || waiting) {
        counts.skippedExisting += 1;
        continue;
      }
    }
    const charged = l.lead_charged;
    if (charged === true) counts.charged += 1;
    else if (charged === false) counts.uncharged += 1;
    else counts.chargedUnknown += 1;

    const ev = buildEvidence(l, messageByLead, calls);
    let notJudged: string | null = ev.notJudged;
    let classification: Classification | null = null;
    let decision: RatingDecision | null = null;

    // The lead's own date, in the account's local calendar — the same basis
    // the snapshot is keyed on.
    const leadDate = ev.createdAt.slice(0, 10);
    const enabled =
      leadDate === today ? (liveEnabled ?? snapshotByDate.get(leadDate)) : snapshotByDate.get(leadDate);
    if (!notJudged && !enabled) notJudged = "no_service_snapshot";

    if (!notJudged && ev.text && enabled) {
      const res = await generateJson(
        systemInstruction(enabled, client.leadQualificationDefinition),
        buildPrompt(l, ev),
      );
      if (!res.ok) {
        notJudged = "model_error";
        errors.push(`lead ${ev.leadId}: ${res.error}`.slice(0, 200));
      } else {
        classification = parseClassification(res.text);
        if (!classification) notJudged = "model_unparseable";
        else {
          decision = decideRating(classification, enabled);
          if (decision.notJudged) notJudged = decision.notJudged;
        }
      }
    }

    const judged = !!decision && !decision.notJudged;
    if (judged && decision) {
      counts.judged += 1;
      counts.byAnswer[decision.answer] = (counts.byAnswer[decision.answer] ?? 0) + 1;
      if (l.resource_name) {
        judgedLeads.push({
          leadId: ev.leadId,
          leadResourceName: String(l.resource_name),
          answer: decision.answer,
          dissatisfiedReason: decision.dissatisfiedReason,
        });
      }
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
        alreadyRated: wantRated,
        serviceId: ev.serviceId,
        categoryId: ev.categoryId,
        evidenceSource: ev.source,
        evidenceExcerpt: ev.text ? ev.text.slice(0, 500) : null,
        matchedServiceId: classification?.requestedService ?? null,
        serviceWasEnabled: decision?.serviceWasEnabled ?? null,
        classification: classification?.classification ?? null,
        usedLabelHint: classification?.usedLabelHint ?? null,
        proposedAnswer: judged ? (decision?.answer ?? null) : null,
        proposedDissatisfiedReason: judged ? (decision?.dissatisfiedReason ?? null) : null,
        modelReasoning: classification?.reasoning ?? null,
        notJudgedReason: judged ? null : notJudged,
        model: GEMINI_MODEL,
        attempts: (prior?.attempts ?? 0) + 1,
        nextAttemptAfter:
          !judged && notJudged && RETRYABLE_REASONS.has(notJudged)
            ? new Date(Date.now() + backoffMinutes((prior?.attempts ?? 0) + 1) * 60_000)
            : null,
      })
      .onConflictDoUpdate({
        target: [lsaLeadRatingDryRuns.lsaClientId, lsaLeadRatingDryRuns.leadId],
        set: {
          alreadyRated: wantRated,
          evidenceSource: ev.source,
          evidenceExcerpt: ev.text ? ev.text.slice(0, 500) : null,
          matchedServiceId: classification?.requestedService ?? null,
          serviceWasEnabled: decision?.serviceWasEnabled ?? null,
          classification: classification?.classification ?? null,
          usedLabelHint: classification?.usedLabelHint ?? null,
          proposedAnswer: judged ? (decision?.answer ?? null) : null,
          proposedDissatisfiedReason: judged ? (decision?.dissatisfiedReason ?? null) : null,
          modelReasoning: classification?.reasoning ?? null,
          notJudgedReason: judged ? null : notJudged,
          model: GEMINI_MODEL,
          attempts: (prior?.attempts ?? 0) + 1,
          nextAttemptAfter:
            !judged && notJudged && RETRYABLE_REASONS.has(notJudged)
              ? new Date(Date.now() + backoffMinutes((prior?.attempts ?? 0) + 1) * 60_000)
              : null,
          createdAt: new Date(),
        },
      });
  }

  return { counts, errors, judgedLeads };
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
