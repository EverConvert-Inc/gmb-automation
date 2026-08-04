import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { callrailWebhookSecrets } from "@/lib/db/schema";
import { encryptString } from "@/lib/crypto";

export const runtime = "nodejs";

// Keyed by CallRail's company_resource_id (e.g. "COM..."), not a ppc/lsa
// client id — see callrailWebhookSecrets in schema.ts: the secret belongs
// to the CallRail company, which can be shared by a ppc_clients row and an
// lsa_clients row at once. Never returns the decrypted secret — this is a
// write-only field in the admin UI, same as a password field.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ companyId: string }> },
) {
  const { companyId } = await params;
  const row = await db.query.callrailWebhookSecrets.findFirst({
    where: eq(callrailWebhookSecrets.callrailCompanyId, companyId),
  });
  return NextResponse.json({
    configured: !!row,
    updatedAt: row?.updatedAt ?? null,
  });
}

const PutBody = z.object({ secret: z.string().min(1) }).strict();

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ companyId: string }> },
) {
  const { companyId } = await params;
  let parsed;
  try {
    parsed = PutBody.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  const secretEncrypted = encryptString(parsed.secret);
  const now = new Date();
  const [row] = await db
    .insert(callrailWebhookSecrets)
    .values({ callrailCompanyId: companyId, secretEncrypted, updatedAt: now })
    .onConflictDoUpdate({
      target: callrailWebhookSecrets.callrailCompanyId,
      set: { secretEncrypted, updatedAt: now },
    })
    .returning();
  return NextResponse.json({ configured: true, updatedAt: row.updatedAt });
}
