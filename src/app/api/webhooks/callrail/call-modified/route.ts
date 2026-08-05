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
import { recomputeLsaCallrailDay } from "@/lib/lsa-sync";

export const runtime = "nodejs";
export const maxDuration = 15;

// Confirmed via a real webhook.site capture history: CallRail's Call
// Modified webhook only ever delivers POST — no GET verification probe
// (unlike e.g. Facebook's webhook handshake). No GET handler needed;
// Next.js returns 405 for any GET on this route, which is correct.

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
  // Checked independently of the PPC loop above (never short-circuited by
  // it) — decides which LSA clients get their own call_signed_events row
  // and true-sign-date correction triggered below (see
  // recomputeLsaCallrailDay). Two lsa_clients can share one CallRail
  // company, each with its own tag-category config — a call matching
  // both gets one row PER client (see the per-client insert loop below),
  // never a single shared row. A call that's `isReal` only via a PPC
  // match (matchedLsaClientIds empty) records no call_signed_events row
  // at all — that table has exactly one consumer (lsa-sync.ts's redirect
  // logic), so there's nothing to key a PPC-only row against.
  const matchedLsaClientIds: string[] = [];
  for (const client of lsaCandidates) {
    const tagCategories = (
      await db.query.lsaCallrailTagCategories.findMany({
        where: eq(lsaCallrailTagCategories.lsaClientId, client.id),
      })
    ).map((c) => ({ ...c, rollup: c.rollup as "real" | "junk" }));
    if (resolveCallIsReal(trackerName, tags, client.signedCaseNameFilters, tagCategories)) {
      isReal = true;
      matchedLsaClientIds.push(client.id);
    }
  }

  console.log(
    `[callrail-webhook] call ${body.resource_id}: isReal=${isReal}, matchedLsaClientIds=${JSON.stringify(matchedLsaClientIds)}, start_time=${body.start_time ?? "(missing)"}, tags=${JSON.stringify(tags)}, tracker=${trackerName}`,
  );

  if (isReal) {
    if (matchedLsaClientIds.length === 0) {
      console.log(
        `[callrail-webhook] call ${body.resource_id}: isReal via PPC-only match (no matched LSA client) — no call_signed_events row to record`,
      );
    } else if (!body.start_time) {
      console.warn(
        `[callrail-webhook] call ${body.resource_id} matched ${matchedLsaClientIds.length} LSA client(s) but payload had no start_time — skipping call_signed_events and the true-sign-date correction entirely`,
      );
    } else {
      const callDate = body.start_time.slice(0, 10);
      // Same signedAt for every matched client's row — they're all
      // recording the SAME real-world sign moment, just once per client
      // (see the lsaClientId comment on callSignedEvents in schema.ts).
      const signedAt = new Date();
      for (const lsaClientId of matchedLsaClientIds) {
        // .returning() distinguishes a genuinely NEW transition from a
        // repeat delivery/no-op conflict for THIS client — the
        // true-sign-date correction below must only ever run once per
        // (call, lsa_client), matching the unique constraint's own
        // idempotency guarantee.
        const inserted = await db
          .insert(callSignedEvents)
          .values({
            callrailCallId: body.resource_id,
            callrailCompanyId: companyResourceId,
            lsaClientId,
            signedAt,
          })
          .onConflictDoNothing()
          .returning();

        console.log(
          `[callrail-webhook] call ${body.resource_id}, lsa_client ${lsaClientId}: call_signed_events insert ${inserted.length > 0 ? "NEW (row created)" : "conflict (already existed — no-op)"}`,
        );

        if (inserted.length === 0) {
          console.log(
            `[callrail-webhook] call ${body.resource_id}, lsa_client ${lsaClientId}: correction NOT triggered (already recorded for this client)`,
          );
          continue;
        }

        console.log(
          `[callrail-webhook] call ${body.resource_id}: triggering recomputeLsaCallrailDay(${lsaClientId}, ${callDate})`,
        );
        try {
          await recomputeLsaCallrailDay(lsaClientId, callDate);
          console.log(
            `[callrail-webhook] call ${body.resource_id}: recomputeLsaCallrailDay(${lsaClientId}, ${callDate}) completed without throwing`,
          );
        } catch (err) {
          console.error(
            `[callrail-webhook] true-sign-date correction failed for lsa_client ${lsaClientId}, call ${body.resource_id}:`,
            (err as Error).message,
          );
        }
      }
    }
  }

  return NextResponse.json({ ok: true, recorded: isReal });
}
