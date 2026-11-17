import { NextResponse } from "next/server";
import {
  parseWebhookPayload,
  verifyHandshake,
  verifyWhatsappSignature,
  type WhatsappWebhookPayload,
} from "@/lib/whatsapp-webhook";
import { applyStatus, ingestInbound } from "@/lib/whatsapp-inbox";

export const runtime = "nodejs";
export const maxDuration = 30;

// Meta's one-time verification when the callback URL is saved in the app
// dashboard (WhatsApp > Configuration). Token = WHATSAPP_WEBHOOK_VERIFY_TOKEN.
export async function GET(req: Request) {
  const challenge = verifyHandshake(
    new URL(req.url).searchParams,
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
  );
  if (challenge === null) return new NextResponse("forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

// Every message and status for every number in every subscribed WABA. One app
// secret signs them all, so there is no per-number lookup before verifying.
export async function POST(req: Request) {
  // Raw bytes, hashed exactly as received: re-serialising the parsed JSON
  // would change the escaping and break the signature.
  const raw = Buffer.from(await req.arrayBuffer());
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    // Misconfiguration, not a forgery. 503 (not CallRail's 200) on purpose:
    // Meta retries for up to 7 days, so once the env var is set every message
    // that arrived meanwhile is redelivered instead of being lost.
    console.error("[whatsapp-webhook] WHATSAPP_APP_SECRET is not set — asking Meta to retry");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }
  if (!verifyWhatsappSignature(raw, req.headers.get("x-hub-signature-256"), appSecret)) {
    console.warn("[whatsapp-webhook] signature verification failed");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: WhatsappWebhookPayload;
  try {
    payload = JSON.parse(raw.toString("utf8")) as WhatsappWebhookPayload;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { inbound, statuses } = parseWebhookPayload(payload);
  let stored = 0;
  let updated = 0;
  // Any failure below returns 500 so Meta retries the whole delivery; every
  // write is idempotent (wamid unique, forward-only status), so the parts
  // that already succeeded are no-ops the second time.
  try {
    for (const m of inbound) if (await ingestInbound(m)) stored++;
    for (const s of statuses) if (await applyStatus(s)) updated++;
  } catch (err) {
    console.error("[whatsapp-webhook] ingest failed:", err);
    return NextResponse.json({ error: "ingest failed" }, { status: 500 });
  }
  if (inbound.length || statuses.length) {
    console.log(
      `[whatsapp-webhook] messages ${stored}/${inbound.length} new, statuses ${updated}/${statuses.length} applied`,
    );
  }
  return NextResponse.json({ ok: true, stored, updated });
}
