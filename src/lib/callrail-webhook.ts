// Logic for CallRail's "Call Modified" webhook — kept separate from
// callrail.ts (the REST API wrapper) since this is a push-based receiver
// with its own payload shape, not another REST call. Route handler
// (src/app/api/webhooks/callrail/call-modified/route.ts) stays thin:
// signature verification and payload interpretation live here so they're
// unit-testable the same way every other lib function in this codebase is
// (this app has no route-handler-level tests — see callrail.test.ts,
// lsa-sync has none either — logic lives in a *.ts the route calls).
//
// Confirmed against a real captured CallRail webhook delivery (raw
// PowerShell replay of a live "Call Modified" event, headers + body):
// - Signature header is literally named "signature" (lowercase) — NOT
//   "x-callrail-signature", which was an earlier single-source doc guess.
// - The signature's decoded byte length is 20 bytes (160 bits) — the exact
//   output size of HMAC-SHA1, not HMAC-SHA256 (32 bytes / 44 base64 chars).
//   This is a base64-arithmetic fact independent of the secret, so it
//   overturns the earlier "HMAC-SHA256" assumption regardless of what the
//   actual secret value is.
// - The body carries BOTH "company_id" (numeric, CallRail's internal id)
//   and "company_resource_id" (string, e.g.
//   "COM338e6107d0eb4712af2d4f2f8a18c900") — the latter matches the format
//   already stored everywhere in this schema as callrailCompanyId
//   (ppc_clients/lsa_clients), so THAT is the field to match against, not
//   company_id.
// - The call's own id is "resource_id" (e.g.
//   "CAL019fb93fce197a38a2788269bcf71b70"), not "call_id".
// - "changes" is a flat array of the field NAMES that changed this event
//   (e.g. ["tag","tags"]) — not a rich per-field old/new-value diff as an
//   earlier doc-only description implied. There is no old-tags value to
//   inspect; only "something about tags changed" plus the call's CURRENT
//   tags. That's sufficient here: see resolveCallIsReal's doc comment for
//   why no historical baseline is needed for calls (unlike the
//   text-message polling approach, which genuinely needs one).
// - The webhook's "tags" field is a plain string[] (e.g. ["Signed", ...]),
//   unlike calls.json's REST response (Array<{id,name}|string>) — no
//   tag-object-vs-string branching needed here.
//
// FULLY CONFIRMED end-to-end against that same real call's actual secret
// (obtained from CallRail's webhook config screen for this company): HMAC-
// SHA1 of the exact raw request body (UTF-8 bytes, no transformation),
// keyed with the secret as a plain string, base64-encoded, reproduces the
// captured signature byte-for-byte. Verified two ways — via
// verifyCallrailWebhookSignature directly, and via a full POST through the
// actual route handler against a scratch DB, which correctly wrote one
// call_signed_events row for this call. Nothing about this construction is
// assumed anymore.

import { createHmac } from "node:crypto";
import { timingSafeEqual } from "./crypto";
import {
  matchesAnyFilter,
  resolveCallRollup,
  type CallrailTagCategoryConfig,
} from "./callrail";

export function verifyCallrailWebhookSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha1", secret).update(rawBody, "utf8").digest("base64");
  return timingSafeEqual(expected, signatureHeader);
}

// CallRail's "Call Modified" webhook fires for edits well beyond tags
// (note, value, transcription_text, recording_duration, auto_score,
// manual_score are all documented as possible changed fields) — this event
// only matters to sign-date tracking when tags themselves are what changed.
// Checks both "tag" and "tags" (case-insensitive) since the one confirmed
// real payload carried both entries for a single tag edit and the exact
// set CallRail always sends isn't otherwise documented.
export function isTagChangeEvent(changes: string[] | null | undefined): boolean {
  return (changes ?? []).some((c) => {
    const lower = c.toLowerCase();
    return lower === "tag" || lower === "tags";
  });
}

export type CallModifiedWebhookPayload = {
  resource_id: string;
  company_resource_id: string;
  tags?: string[] | null;
  changes?: string[] | null;
  source_name?: string | null;
  formatted_tracking_source?: string | null;
};

// Whether this call currently resolves "real" under ONE candidate client's
// configuration (its tracker-name filters + tag categories) — mirrors
// pullCallsForCompany's exact same two-step gate (matchesAnyFilter, then
// resolveCallRollup's Junk>Real priority) so a call the daily sync would
// never have counted as real for this client doesn't get a sign-event
// fired for it here either.
//
// Unlike the text-message polling approach, this needs NO stored "previous
// state" baseline to detect a genuine transition: the webhook is push-based
// and only fires when CallRail itself recorded a change, so the FIRST time
// we ever observe "real" for a given call_id via this webhook is — by
// construction — the true real-time moment of that change (a repeat
// tag-change event on the same call_id that still resolves real, e.g. an
// unrelated tag added alongside an already-Signed one, is a no-op via the
// call_signed_events unique constraint on callrail_call_id, so it can never
// double-fire or "re-date" an already-recorded call).
export function resolveCallIsReal(
  trackerName: string,
  tags: string[],
  nameFilters: string[],
  tagCategories: CallrailTagCategoryConfig[],
): boolean {
  const filtersLower = nameFilters.map((f) => f.trim().toLowerCase()).filter(Boolean);
  if (!matchesAnyFilter(trackerName.toLowerCase(), filtersLower)) return false;
  const tagsLower = tags.map((t) => t.toLowerCase());
  const categories = tagCategories.map((c) => ({
    label: c.label,
    tag: c.callrailTagName.trim().toLowerCase(),
    rollup: c.rollup,
  }));
  const matched = categories.filter((c) => tagsLower.includes(c.tag));
  return resolveCallRollup(matched) === "real";
}
