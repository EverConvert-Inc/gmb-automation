// WhatsApp Cloud API client (Meta Graph API). Pure: no DB access, so it can
// be unit-tested with a stubbed fetch the way reddit-ads.ts is.
//
// Credentials are env-only. Every number lives in EverConvert's own business
// portfolio, so one system-user token covers all of them:
//   WHATSAPP_ACCESS_TOKEN  system-user token with whatsapp_business_messaging,
//                          whatsapp_business_management and business_management
//   WHATSAPP_BUSINESS_ID   the portfolio id, for discovering its WABAs
// (The webhook's own secrets live in whatsapp-webhook.ts.)
//
// Version is pinned, never "latest": Graph changes field shapes between
// versions. v25.0 (Feb 2026) expires July 2028; v27.0 was the newest when
// this was written. Bump deliberately and re-check the payloads.
export const GRAPH_API_VERSION = "v25.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export class WhatsappApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
  ) {
    super(message);
    this.name = "WhatsappApiError";
  }
}

export function getAccessToken(): string {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) throw new Error("WHATSAPP_ACCESS_TOKEN is not set");
  return token;
}

type FetchLike = typeof fetch;

async function graph<T>(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown; token?: string; fetchImpl?: FetchLike } = {},
): Promise<T> {
  const token = init.token ?? getAccessToken();
  const doFetch = init.fetchImpl ?? fetch;
  const res = await doFetch(`${GRAPH_BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as
    | (T & { error?: { message?: string; code?: number; error_user_msg?: string } })
    | null;
  if (!res.ok || json?.error) {
    const e = json?.error;
    throw new WhatsappApiError(
      e?.error_user_msg || e?.message || `Graph API HTTP ${res.status}`,
      res.status,
      e?.code,
    );
  }
  return json as T;
}

// Follows Graph's cursor paging for list edges.
async function graphList<T>(path: string, opts: { token?: string; fetchImpl?: FetchLike } = {}) {
  const out: T[] = [];
  let next: string | null = path;
  for (let page = 0; next && page < 20; page++) {
    const body: { data?: T[]; paging?: { next?: string } } = await graph(next, opts);
    out.push(...(body.data ?? []));
    // paging.next is an absolute URL; strip our base so graph() can re-add it.
    const n = body.paging?.next;
    next = n ? n.replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+/, "") : null;
  }
  return out;
}

export type Waba = { id: string; name?: string };

// WABAs the portfolio owns, plus any a client shared with it. Each list is
// fetched independently: a portfolio with nothing shared can answer the
// client_ edge with a permissions error, which must not hide owned ones.
export async function listWabas(
  businessId: string,
  opts: { token?: string; fetchImpl?: FetchLike } = {},
): Promise<{ wabas: Waba[]; errors: string[] }> {
  const errors: string[] = [];
  const byId = new Map<string, Waba>();
  for (const edge of ["owned_whatsapp_business_accounts", "client_whatsapp_business_accounts"]) {
    try {
      for (const w of await graphList<Waba>(`/${businessId}/${edge}?fields=id,name`, opts)) {
        byId.set(w.id, w);
      }
    } catch (err) {
      errors.push(`${edge}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { wabas: [...byId.values()], errors };
}

export type GraphPhoneNumber = {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  platform_type?: string;
  code_verification_status?: string;
};

// No `fields` param on purpose: the default response already carries
// display_phone_number, verified_name, quality_rating, platform_type and
// code_verification_status, and asking for a field name Graph doesn't know
// fails the whole call.
export function listPhoneNumbers(wabaId: string, opts: { token?: string; fetchImpl?: FetchLike } = {}) {
  return graphList<GraphPhoneNumber>(`/${wabaId}/phone_numbers`, opts);
}

// Webhooks only arrive for a WABA once our app is subscribed to it.
export async function subscribeAppToWaba(
  wabaId: string,
  opts: { token?: string; fetchImpl?: FetchLike } = {},
): Promise<boolean> {
  const body = await graph<{ success?: boolean }>(`/${wabaId}/subscribed_apps`, {
    ...opts,
    method: "POST",
  });
  return body.success === true;
}

export type SendResult = { wamid: string; waId: string | null };

// Free-form text. Only valid inside the 24-hour customer-service window;
// outside it Meta answers with error 131047 and an approved template is
// required instead.
export async function sendText(
  phoneNumberId: string,
  to: string,
  body: string,
  opts: { token?: string; fetchImpl?: FetchLike } = {},
): Promise<SendResult> {
  const res = await graph<{
    contacts?: Array<{ input?: string; wa_id?: string }>;
    messages?: Array<{ id?: string }>;
  }>(`/${phoneNumberId}/messages`, {
    ...opts,
    method: "POST",
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body, preview_url: false },
    },
  });
  const wamid = res.messages?.[0]?.id;
  if (!wamid) throw new WhatsappApiError("Graph accepted the send but returned no message id", 200);
  return { wamid, waId: res.contacts?.[0]?.wa_id ?? null };
}

// Media is two hops: the media id resolves to a short-lived URL, and that URL
// needs the same bearer token to download.
export async function downloadMedia(
  mediaId: string,
  opts: { token?: string; fetchImpl?: FetchLike } = {},
): Promise<{ body: ReadableStream<Uint8Array> | null; mimeType: string; size: number | null }> {
  const meta = await graph<{ url?: string; mime_type?: string; file_size?: number }>(
    `/${encodeURIComponent(mediaId)}`,
    opts,
  );
  if (!meta.url) throw new WhatsappApiError("Media has no download URL", 404);
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(meta.url, {
    headers: { Authorization: `Bearer ${opts.token ?? getAccessToken()}` },
    cache: "no-store",
  });
  if (!res.ok) throw new WhatsappApiError(`Media download HTTP ${res.status}`, res.status);
  return {
    body: res.body,
    mimeType: meta.mime_type ?? res.headers.get("content-type") ?? "application/octet-stream",
    size: meta.file_size ?? null,
  };
}

export type RawGraphResponse = { httpStatus: number; body: string };

// Registers a number for the Cloud API (POST /{phone_number_id}/register).
// The pin becomes, or must match, the number's two-step verification PIN.
//
// Returns Meta's response verbatim (status + raw body text) instead of
// throwing, because the caller shows it to the operator exactly as sent.
// The pin is only ever placed in this request body: never logged, never
// stored, never echoed back.
export async function registerPhoneNumber(
  phoneNumberId: string,
  pin: string,
  opts: { token?: string; fetchImpl?: FetchLike } = {},
): Promise<RawGraphResponse> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(`${GRAPH_BASE}/${encodeURIComponent(phoneNumberId)}/register`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.token ?? getAccessToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", pin }),
    cache: "no-store",
  });
  return { httpStatus: res.status, body: await res.text() };
}
