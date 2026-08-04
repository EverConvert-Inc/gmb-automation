import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import {
  callSignedEvents,
  callrailWebhookSecrets,
  lsaCallrailTagCategories,
  lsaClients,
  ppcCallrailTagCategories,
  ppcClients,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { decryptString } from "@/lib/crypto";
import {
  isTagChangeEvent,
  resolveCallIsReal,
  verifyCallrailWebhookSignature,
  type CallModifiedWebhookPayload,
} from "@/lib/callrail-webhook";

export const runtime = "nodejs";
export const maxDuration = 15;

// CallRail's setup flow appears to probe the URL with a GET before/while
// saving a webhook (observed alongside the real POST delivery this route
// was built against) — respond 200 with no verification so the URL passes
// reachability checks. Unconfirmed whether CallRail expects anything more
// specific (e.g. an echoed challenge value); revisit if webhook setup in
// CallRail's UI doesn't actually activate against this route.
export async function GET() {
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("signature");

  let body: CallModifiedWebhookPayload;
  try {
    body = JSON.parse(rawBody) as CallModifiedWebhookPayload;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const companyResourceId = body.company_resource_id;
  if (!companyResourceId || !body.resource_id) {
    return NextResponse.json({ error: "missing company_resource_id or resource_id" }, { status: 400 });
  }

  const secretRow = await db.query.callrailWebhookSecrets.findFirst({
    where: eq(callrailWebhookSecrets.callrailCompanyId, companyResourceId),
  });
  if (!secretRow) {
    console.warn(
      `[callrail-webhook] no webhook secret configured for company ${companyResourceId} — ignoring`,
    );
    return NextResponse.json({ error: "not configured" }, { status: 404 });
  }

  const secret = decryptString(secretRow.secretEncrypted);
  if (!verifyCallrailWebhookSignature(rawBody, signature, secret)) {
    console.warn(
      `[callrail-webhook] signature verification failed for company ${companyResourceId}, call ${body.resource_id}`,
    );
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  if (!isTagChangeEvent(body.changes)) {
    return NextResponse.json({ ok: true, recorded: false, reason: "not a tag change" });
  }

  const trackerName = body.source_name ?? body.formatted_tracking_source ?? "";
  const tags = body.tags ?? [];

  const [ppcCandidates, lsaCandidates] = await Promise.all([
    db.query.ppcClients.findMany({
      where: eq(ppcClients.callrailCompanyId, companyResourceId),
    }),
    db.query.lsaClients.findMany({
      where: eq(lsaClients.callrailCompanyId, companyResourceId),
    }),
  ]);

  let isReal = false;
  for (const client of ppcCandidates) {
    const tagCategories = (
      await db.query.ppcCallrailTagCategories.findMany({
        where: eq(ppcCallrailTagCategories.ppcClientId, client.id),
      })
    ).map((c) => ({ ...c, rollup: c.rollup as "real" | "junk" }));
    if (resolveCallIsReal(trackerName, tags, client.signedCaseNameFilters, tagCategories)) {
      isReal = true;
      break;
    }
  }
  if (!isReal) {
    for (const client of lsaCandidates) {
      const tagCategories = (
        await db.query.lsaCallrailTagCategories.findMany({
          where: eq(lsaCallrailTagCategories.lsaClientId, client.id),
        })
      ).map((c) => ({ ...c, rollup: c.rollup as "real" | "junk" }));
      if (resolveCallIsReal(trackerName, tags, client.signedCaseNameFilters, tagCategories)) {
        isReal = true;
        break;
      }
    }
  }

  if (isReal) {
    await db
      .insert(callSignedEvents)
      .values({
        callrailCallId: body.resource_id,
        callrailCompanyId: companyResourceId,
        signedAt: new Date(),
      })
      .onConflictDoNothing();
  }

  return NextResponse.json({ ok: true, recorded: isReal });
}
