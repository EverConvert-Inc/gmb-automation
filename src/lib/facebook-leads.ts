import { createHmac } from "node:crypto";
import { timingSafeEqual } from "./crypto";

const GRAPH_API_VERSION = "v21.0";
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

const SIGNATURE_PREFIX = "sha256=";

// Facebook signs every webhook POST body with HMAC-SHA256 keyed by the
// app secret (not the Page Access Token). Verify against the *raw* body
// string — the caller must capture it via req.text() before any JSON
// parsing, since re-serializing would produce different bytes than what
// Facebook actually signed.
export function verifyFacebookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }
  const provided = signatureHeader.slice(SIGNATURE_PREFIX.length);
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  return timingSafeEqual(provided, expected);
}

// Meta's own field keys for Lead Ads' built-in contact fields. Used only to
// populate the denormalized query columns on fb_leads — the notification
// email still renders every field_data entry generically by label, see
// fb-lead-email.ts.
const FULL_NAME_KEY = "full_name";
const EMAIL_KEY = "email";
const PHONE_KEY = "phone_number";
const STATE_KEY = "state";

export type FieldDataEntry = { name: string; values: string[] };

export type LeadFieldEntry = { key: string; label: string; value: string };

type GraphLeadResponse = {
  field_data?: FieldDataEntry[];
  form_id?: string;
  page_id?: string;
  created_time?: string;
  error?: { message: string; type: string; code: number };
};

type GraphFormQuestion = { key: string; label: string };

type GraphFormResponse = {
  questions?: GraphFormQuestion[];
  error?: { message: string; type: string; code: number };
};

async function graphGet<T>(path: string, accessToken: string): Promise<T> {
  const url = `${GRAPH_API_BASE}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url);
  const body = (await res.json()) as T & { error?: { message: string } };
  if (!res.ok || body.error) {
    throw new Error(
      `Graph API request failed (${res.status}): ${body.error?.message ?? res.statusText}`,
    );
  }
  return body;
}

export async function fetchLeadFieldData(
  leadgenId: string,
  accessToken: string,
): Promise<FieldDataEntry[]> {
  const data = await graphGet<GraphLeadResponse>(
    `/${leadgenId}?fields=field_data`,
    accessToken,
  );
  return data.field_data ?? [];
}

// Question labels aren't included in the lead itself — they live on the
// form definition. Fetched per-form (not cached) since this is a
// low-volume webhook, not a hot path.
export async function fetchFormQuestionLabels(
  formId: string,
  accessToken: string,
): Promise<Map<string, string>> {
  const data = await graphGet<GraphFormResponse>(
    `/${formId}?fields=questions`,
    accessToken,
  );
  const map = new Map<string, string>();
  for (const q of data.questions ?? []) {
    map.set(q.key, q.label);
  }
  return map;
}

function humanizeFieldKey(key: string): string {
  return key
    .split("_")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// Combines field_data with the form's question labels, preserving the
// order the lead answered in. Falls back to a humanized field key when a
// label can't be resolved (e.g. the form lookup failed) rather than
// dropping the field.
export function buildLeadFieldEntries(
  fieldData: FieldDataEntry[],
  labels: Map<string, string>,
): LeadFieldEntry[] {
  return fieldData.map((f) => ({
    key: f.name,
    label: labels.get(f.name) ?? humanizeFieldKey(f.name),
    value: f.values.join(", "),
  }));
}

export type StandardLeadFields = {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  state: string | null;
};

export function extractStandardFields(fieldData: FieldDataEntry[]): StandardLeadFields {
  const byKey = new Map(fieldData.map((f) => [f.name, f.values.join(", ")]));
  return {
    fullName: byKey.get(FULL_NAME_KEY) ?? null,
    email: byKey.get(EMAIL_KEY) ?? null,
    phone: byKey.get(PHONE_KEY) ?? null,
    state: byKey.get(STATE_KEY) ?? null,
  };
}
