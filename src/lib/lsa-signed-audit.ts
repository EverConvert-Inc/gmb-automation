// TEMPORARY DIAGNOSTIC — pure half of /api/cron/lsa-signed-audit. Read-only,
// no DB or network access. Delete together with that route once the
// Panchenko Oct 2026 Signed-count question is answered.
//
// Mirrors which day each real call lands on in lsa_leads_daily.signed_cases,
// per lsa-sync.ts's applySignedDateCorrections + applyRedirectedInContributions:
//
//   - A real call counts on its own date, UNLESS it has a call_signed_events
//     row whose signed_at (Eastern) is a different date — then it is removed
//     from its own date ("moved out").
//   - Every call_signed_events row with is_rollup_real = true, plus every row
//     a sync over this range would set true right now (the moved-out ones),
//     counts on its signed_at date ("moved in") — whether or not the call is
//     still real today. That is the sync's behavior, reproduced as-is.
//   - GMB-channel items adjust rollup counts but never signed_cases.
//
// Deliberately reproduces the sync's quirks rather than fixing them: if the
// same call lands twice, both rows appear and are flagged.

import { toIsoDateEastern } from "./date-utils";

type Channel = "GMB" | "PPC" | "LSA" | "PMax" | null;

export type AuditCandidate = {
  callId: string;
  /** The call's own date, as pullCallsForCompany assigns it. */
  date: string;
  channel: Channel;
};

export type AuditSignedEvent = {
  callId: string;
  signedAt: Date;
  isRollupReal: boolean | null;
  channel: string | null;
};

export type CallAttribution = {
  callId: string;
  /** Null when the call isn't in this range's real candidates. */
  originDate: string | null;
  signedDateEastern: string | null;
  countedOn: string;
  path: "own-date" | "moved-in";
  channel: Channel;
  /** False for GMB: counted in rollup_breakdown, not in signed_cases. */
  countsTowardSigned: boolean;
  /** True when the call is among this range's current real candidates. */
  isCurrentCandidate: boolean;
  /** The stored is_rollup_real, for showing why a row was moved in. */
  storedIsRollupReal: boolean | null;
};

export function attributeSignedCalls(
  candidates: readonly AuditCandidate[],
  events: readonly AuditSignedEvent[],
  fromDate: string,
  toDate: string,
): CallAttribution[] {
  const eventByCallId = new Map(events.map((e) => [e.callId, e]));
  const candidateByCallId = new Map(candidates.map((c) => [c.callId, c]));
  const out: CallAttribution[] = [];
  const movedOut = new Set<string>();

  for (const c of candidates) {
    const event = eventByCallId.get(c.callId);
    const signedDate = event ? toIsoDateEastern(event.signedAt) : null;
    if (event && signedDate !== c.date) {
      movedOut.add(c.callId);
      continue;
    }
    out.push({
      callId: c.callId,
      originDate: c.date,
      signedDateEastern: signedDate,
      countedOn: c.date,
      path: "own-date",
      channel: c.channel,
      countsTowardSigned: c.channel !== "GMB",
      isCurrentCandidate: true,
      storedIsRollupReal: event?.isRollupReal ?? null,
    });
  }

  for (const e of events) {
    if (e.isRollupReal !== true && !movedOut.has(e.callId)) continue;
    const target = toIsoDateEastern(e.signedAt);
    const candidate = candidateByCallId.get(e.callId);
    // A moved candidate whose target falls outside this range still lands
    // there (via recomputeLsaCallrailDay) — kept so it's visible, not hidden.
    if (!candidate && (target < fromDate || target > toDate)) continue;
    // The sync persists the candidate's channel onto the row before reading
    // it back, so a just-moved call uses the candidate's channel.
    const channel = (candidate ? candidate.channel : e.channel) as Channel;
    out.push({
      callId: e.callId,
      originDate: candidate?.date ?? null,
      signedDateEastern: target,
      countedOn: target,
      path: "moved-in",
      channel,
      countsTowardSigned: channel !== "GMB",
      isCurrentCandidate: !!candidate,
      storedIsRollupReal: e.isRollupReal,
    });
  }

  return out;
}

export type TextMessageForAudit = {
  created_at: string;
  tags: string[];
};

/**
 * Same per-message rule as pullTextMessagesForCompany: each message's own
 * tags resolve independently (junk beats real within a message), and the
 * conversation counts once, on the date of its earliest real message —
 * `created_at.slice(0, 10)`, exactly as the sync slices it.
 */
export function earliestRealMessage(
  messages: readonly TextMessageForAudit[],
  categories: ReadonlyArray<{ label: string; callrailTagName: string; rollup: "real" | "junk" }>,
): { createdAt: string; date: string; labels: string[] } | null {
  const cats = categories.map((c) => ({ ...c, tag: c.callrailTagName.trim().toLowerCase() }));
  let best: { createdAt: string; labels: string[] } | null = null;
  for (const m of messages) {
    const tags = m.tags.map((t) => t.toLowerCase());
    const matched = cats.filter((c) => tags.includes(c.tag));
    if (matched.some((c) => c.rollup === "junk")) continue;
    if (!matched.some((c) => c.rollup === "real")) continue;
    if (!best || m.created_at < best.createdAt) {
      best = { createdAt: m.created_at, labels: matched.map((c) => c.label) };
    }
  }
  return best && { ...best, date: best.createdAt.slice(0, 10) };
}

/** Last 10 digits, so "+1 (980) 497-1221" and "980-497-1221" compare equal. */
export function phoneKey(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "").slice(-10);
}
