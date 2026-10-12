import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { callrailWebhookSecrets, ppcClients } from "@/lib/db/schema";
import { isUsStateCode } from "@/lib/us-states";

export const runtime = "nodejs";

const PatchBody = z
  .object({
    name: z.string().min(1).optional(),
    isActive: z.boolean().optional(),
    googleAdsCustomerId: z.string().nullable().optional(),
    callrailCompanyId: z.string().nullable().optional(),
    signedCaseTag: z.string().min(1).optional(),
    signedCaseNameFilters: z.array(z.string().min(1)).optional(),
    gmbCallrailNameFilters: z.array(z.string().min(1)).optional(),
    // Not nullable — every client gets a state at creation now, so editing
    // it means picking a different valid one, not clearing it.
    state: z.string().refine(isUsStateCode, "must be a valid US state code").optional(),
  })
  .strict();

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const row = await db.query.ppcClients.findFirst({
    where: eq(ppcClients.id, id),
  });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let parsed;
  try {
    parsed = PatchBody.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }
  // Refuse to link a CallRail company that has no webhook secret on file.
  // That combination is the state which silently breaks real-time sign
  // tracking: the receiver cannot verify any delivery for the company, so
  // every Call Modified event is acknowledged and discarded (see the
  // not-configured branch in the call-modified route).
  //
  // This is always satisfiable BEFORE linking — CallRail exposes the secret
  // under Advanced Settings on the webhook config as soon as the webhook is
  // created, and PUT /api/callrail/webhook-secret/[companyId] is keyed by
  // company id alone, so the secret can be saved with no client linked to
  // it yet.
  //
  // Keyed on a truthy id on purpose: an absent field (editing anything else
  // on an already-linked client) and an explicit null or "" (unlinking)
  // both skip the check, so only an actual link is ever blocked.
  if (parsed.callrailCompanyId) {
    const secretRow = await db.query.callrailWebhookSecrets.findFirst({
      where: eq(
        callrailWebhookSecrets.callrailCompanyId,
        parsed.callrailCompanyId,
      ),
    });
    if (!secretRow) {
      return NextResponse.json(
        {
          error: `No webhook secret saved for CallRail company ${parsed.callrailCompanyId}. Paste it from CallRail (that company's Call Modified webhook \u2192 Advanced Settings) into the webhook secret field, then link the company.`,
        },
        { status: 400 },
      );
    }
  }

  const [row] = await db
    .update(ppcClients)
    .set({ ...parsed, updatedAt: new Date() })
    .where(eq(ppcClients.id, id))
    .returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const [row] = await db
    .delete(ppcClients)
    .where(eq(ppcClients.id, id))
    .returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
