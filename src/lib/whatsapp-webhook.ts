// WhatsApp Cloud API webhook: verification and payload interpretation. Kept
// out of the route handler (src/app/api/webhooks/whatsapp/route.ts) so it is
// unit-testable, like callrail-webhook.ts.
//
// Per Meta's webhook docs (not yet confirmed against a live delivery here —
// first real payload should be checked against this):
// - GET handshake: hub.mode=subscribe, hub.verify_token, hub.challenge. Answer
//   200 with the raw challenge when the token matches.
// - POST: X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw body, keyed
//   with the Meta APP SECRET>. One secret for the whole app, so every number
//   shares it; nothing per-number to store.
// - Meta retries non-2xx deliveries for up to 7 days and a delivery can batch
//   many entries/changes, so ingestion must be idempotent (wamid unique).
// - Since the 2026 usernames rollout a contact is identified by a
//   business-scoped user id (contacts[].user_id / messages[].from_user_id),
//   and the phone (wa_id / from) may be omitted.

import { createHmac } from "node:crypto";
import { timingSafeEqual } from "./crypto";

export function verifyWhatsappSignature(
  rawBody: Buffer | string,
  signatureHeader: string | null | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader || !appSecret) return false;
  const expected =
    "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");
  // Meta sends lowercase hex; normalise the prefix/hex case anyway.
  return timingSafeEqual(expected, signatureHeader.trim().toLowerCase());
}

// Returns the challenge to echo back, or null to refuse.
export function verifyHandshake(params: URLSearchParams, verifyToken: string | undefined): string | null {
  if (!verifyToken) return null;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  if (mode !== "subscribe" || !token || challenge === null) return null;
  return timingSafeEqual(token, verifyToken) ? challenge : null;
}

// --- Payload types (only the fields this module reads) ---------------------

type MediaPart = { id?: string; mime_type?: string; caption?: string; filename?: string };

export type WebhookMessage = {
  id: string;
  from?: string;
  from_user_id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: MediaPart;
  video?: MediaPart;
  audio?: MediaPart & { voice?: boolean };
  document?: MediaPart;
  sticker?: MediaPart;
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contacts?: Array<{ name?: { formatted_name?: string } }>;
  button?: { text?: string; payload?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
  reaction?: { message_id?: string; emoji?: string };
  referral?: Record<string, unknown>;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
};

type WebhookContact = {
  wa_id?: string;
  user_id?: string;
  profile?: { name?: string; username?: string };
};

type WebhookStatus = {
  id?: string;
  status?: string;
  timestamp?: string;
  errors?: Array<{
    code?: number;
    title?: string;
    message?: string;
    error_data?: { details?: string };
  }>;
};

export type WhatsappWebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string; // WABA id
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { display_phone_number?: string; phone_number_id?: string };
        contacts?: WebhookContact[];
        messages?: WebhookMessage[];
        statuses?: WebhookStatus[];
      };
    }>;
  }>;
};

// --- Normalised output -----------------------------------------------------

export type InboundMessage = {
  wabaId: string | null;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  userId: string | null;
  waId: string | null;
  profileName: string | null;
  username: string | null;
  wamid: string;
  sentAt: Date;
  type: string;
  body: string | null;
  mediaId: string | null;
  mediaMimeType: string | null;
  mediaFilename: string | null;
  referral: Record<string, unknown> | null;
  raw: WebhookMessage;
};

export type StatusUpdate = {
  wamid: string;
  status: string;
  at: Date;
  errorMessage: string | null;
};

function tsToDate(ts: string | undefined, fallback: Date): Date {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : fallback;
}

// What to show for a message: its text, caption, or a short description.
export function describeMessage(m: WebhookMessage): {
  type: string;
  body: string | null;
  mediaId: string | null;
  mediaMimeType: string | null;
  mediaFilename: string | null;
} {
  const type = m.type ?? "unknown";
  const media =
    type === "image" ? m.image
    : type === "video" ? m.video
    : type === "audio" ? m.audio
    : type === "document" ? m.document
    : type === "sticker" ? m.sticker
    : undefined;
  let body: string | null = null;
  switch (type) {
    case "text":
      body = m.text?.body ?? null;
      break;
    case "image":
    case "video":
    case "document":
      body = media?.caption ?? null;
      break;
    case "location": {
      const l = m.location;
      const place = [l?.name, l?.address].filter(Boolean).join(", ");
      body = l?.latitude !== undefined && l?.longitude !== undefined
        ? `${place ? place + " " : ""}(${l.latitude}, ${l.longitude})`
        : place || null;
      break;
    }
    case "contacts":
      body = (m.contacts ?? []).map((c) => c.name?.formatted_name).filter(Boolean).join(", ") || null;
      break;
    case "button":
      body = m.button?.text ?? m.button?.payload ?? null;
      break;
    case "interactive":
      body = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null;
      break;
    case "reaction":
      body = m.reaction?.emoji ? `Reacted ${m.reaction.emoji}` : "Removed a reaction";
      break;
    case "unsupported":
      body = m.errors?.[0]?.title ?? m.errors?.[0]?.message ?? null;
      break;
  }
  return {
    type,
    body,
    mediaId: media?.id ?? null,
    mediaMimeType: media?.mime_type ?? null,
    mediaFilename: type === "document" ? media?.filename ?? null : null,
  };
}

// One-line preview for the conversation list.
export function previewText(type: string, body: string | null): string {
  if (body) return body.length > 140 ? body.slice(0, 139) + "…" : body;
  const labels: Record<string, string> = {
    image: "Photo",
    video: "Video",
    audio: "Voice message",
    document: "Document",
    sticker: "Sticker",
    location: "Location",
    contacts: "Contact card",
  };
  return labels[type] ?? `[${type}]`;
}

export function parseWebhookPayload(
  payload: WhatsappWebhookPayload,
  now: Date = new Date(),
): { inbound: InboundMessage[]; statuses: StatusUpdate[] } {
  const inbound: InboundMessage[] = [];
  const statuses: StatusUpdate[] = [];
  if (payload.object !== "whatsapp_business_account") return { inbound, statuses };

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const v = change.value ?? {};
      const phoneNumberId = v.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      const contacts = v.contacts ?? [];

      for (const m of v.messages ?? []) {
        if (!m.id) continue;
        // Match the sender to its contacts[] entry by BSUID, then phone;
        // a single-contact change (the normal case) needs no match.
        const contact =
          contacts.find((c) => m.from_user_id && c.user_id === m.from_user_id) ??
          contacts.find((c) => m.from && c.wa_id === m.from) ??
          (contacts.length === 1 ? contacts[0] : undefined);
        const userId = m.from_user_id ?? contact?.user_id ?? null;
        const waId = m.from ?? contact?.wa_id ?? null;
        if (!userId && !waId) continue; // nobody to file it under
        const d = describeMessage(m);
        inbound.push({
          wabaId: entry.id ?? null,
          phoneNumberId,
          displayPhoneNumber: v.metadata?.display_phone_number ?? null,
          userId,
          waId,
          profileName: contact?.profile?.name ?? null,
          username: contact?.profile?.username ?? null,
          wamid: m.id,
          sentAt: tsToDate(m.timestamp, now),
          ...d,
          referral: m.referral ?? null,
          raw: m,
        });
      }

      for (const s of v.statuses ?? []) {
        if (!s.id || !s.status) continue;
        const e = s.errors?.[0];
        statuses.push({
          wamid: s.id,
          status: s.status,
          at: tsToDate(s.timestamp, now),
          errorMessage: e
            ? [e.code, e.title, e.error_data?.details ?? e.message].filter(Boolean).join(" · ")
            : null,
        });
      }
    }
  }
  return { inbound, statuses };
}

// Outbound status only moves forward. Webhooks can arrive out of order (a
// "read" can land before "delivered"), so a late lower-ranked status must
// not overwrite a higher one. "failed" outranks everything.
const STATUS_RANK: Record<string, number> = {
  sending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};
export function statusRank(status: string): number {
  return STATUS_RANK[status] ?? -1;
}

// Free-form messages are only allowed within 24h of the customer's last
// inbound message; after that Meta requires an approved template.
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
export function serviceWindowClosesAt(lastInboundAt: Date | null): Date | null {
  return lastInboundAt ? new Date(lastInboundAt.getTime() + SERVICE_WINDOW_MS) : null;
}
export function canReplyFreeform(lastInboundAt: Date | null, now: Date = new Date()): boolean {
  const closes = serviceWindowClosesAt(lastInboundAt);
  return closes !== null && now.getTime() < closes.getTime();
}
