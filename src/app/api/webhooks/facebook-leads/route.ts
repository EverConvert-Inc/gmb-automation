import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { fbLeadClients, fbLeads } from "@/lib/db/schema";
import { decryptString, timingSafeEqual } from "@/lib/crypto";
import {
  buildLeadFieldEntries,
  extractStandardFields,
  fetchFormQuestionLabels,
  fetchLeadFieldData,
  verifyFacebookSignature,
} from "@/lib/facebook-leads";
import { sendFbLeadEmail } from "@/lib/fb-lead-email";

export const runtime = "nodejs";
export const maxDuration = 30;

type LeadgenChangeValue = {
  page_id?: string;
  form_id?: string;
  leadgen_id?: string;
};

type WebhookBody = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{ field?: string; value?: LeadgenChangeValue }>;
  }>;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  const expected = process.env.FB_WEBHOOK_VERIFY_TOKEN ?? "";

  if (mode === "subscribe" && expected && timingSafeEqual(token, expected)) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

async function processLeadgenChange(value: LeadgenChangeValue) {
  const { page_id: pageId, form_id: formId, leadgen_id: leadgenId } = value;
  if (!pageId || !formId || !leadgenId) {
    console.warn("[fb-leads] change missing page_id/form_id/leadgen_id", value);
    return { status: "skipped" as const, reason: "incomplete change payload" };
  }

  const client = await db.query.fbLeadClients.findFirst({
    where: eq(fbLeadClients.pageId, pageId),
  });
  if (!client || !client.isActive) {
    console.warn("[fb-leads] no active fb_lead_clients row for page_id", pageId);
    return { status: "skipped" as const, reason: "unknown or inactive page_id" };
  }

  const accessToken = decryptString(client.pageAccessTokenEncrypted);

  const fieldData = await fetchLeadFieldData(leadgenId, accessToken);
  const labels = await fetchFormQuestionLabels(formId, accessToken).catch((err) => {
    console.warn("[fb-leads] failed to load form question labels", formId, err);
    return new Map<string, string>();
  });
  const fields = buildLeadFieldEntries(fieldData, labels);
  const standard = extractStandardFields(fieldData);

  const inserted = await db
    .insert(fbLeads)
    .values({
      fbLeadClientId: client.id,
      pageId,
      formId,
      leadgenId,
      fullName: standard.fullName,
      email: standard.email,
      phone: standard.phone,
      state: standard.state,
      fieldData,
    })
    .onConflictDoNothing({ target: fbLeads.leadgenId })
    .returning({ id: fbLeads.id });

  if (inserted.length === 0) {
    return { status: "duplicate" as const };
  }

  const result = await sendFbLeadEmail({ clientName: client.name, fields });
  if (result.sent > 0) {
    await db
      .update(fbLeads)
      .set({ emailSentAt: new Date() })
      .where(eq(fbLeads.id, inserted[0].id));
  } else {
    console.warn("[fb-leads] lead stored but no email sent", result);
  }

  return { status: "processed" as const, leadId: inserted[0].id };
}

export async function POST(req: Request) {
  // Read the raw body first — verification must run against the exact
  // bytes Facebook signed. Calling req.json() before this would consume
  // the stream and force us to verify against a re-serialized (and
  // potentially byte-different) copy instead.
  const rawBody = await req.text();

  const appSecret = process.env.FB_APP_SECRET ?? "";
  const signature = req.headers.get("x-hub-signature-256");
  if (!appSecret || !verifyFacebookSignature(rawBody, signature, appSecret)) {
    console.warn("[fb-leads] rejected webhook: missing or invalid X-Hub-Signature-256");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: WebhookBody;
  try {
    body = JSON.parse(rawBody) as WebhookBody;
  } catch (err) {
    console.error("[fb-leads] invalid JSON body", (err as Error).message);
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const changes = (body.entry ?? []).flatMap((entry) => entry.changes ?? []);
  const leadgenChanges = changes.filter((c) => c.field === "leadgen" && c.value);

  let processed = 0;
  let duplicate = 0;
  let skipped = 0;

  for (const change of leadgenChanges) {
    try {
      const result = await processLeadgenChange(change.value!);
      if (result.status === "processed") processed++;
      else if (result.status === "duplicate") duplicate++;
      else skipped++;
    } catch (err) {
      // Log and continue — one bad lead shouldn't fail the whole batch or
      // make Facebook retry leads we already handled successfully.
      console.error("[fb-leads] failed to process leadgen change", change.value, err);
      skipped++;
    }
  }

  return NextResponse.json({ ok: true, processed, duplicate, skipped });
}
