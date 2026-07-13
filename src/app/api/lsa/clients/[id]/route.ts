import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { lsaClients } from "@/lib/db/schema";

export const runtime = "nodejs";

const PatchBody = z
  .object({
    name: z.string().min(1).optional(),
    isActive: z.boolean().optional(),
    googleAdsCustomerId: z.string().nullable().optional(),
    // Per-client MCC override — LSA MCCs are separate from PPC's, so
    // this can't rely on the single global GOOGLE_ADS_LOGIN_CUSTOMER_ID
    // env var the way PPC does.
    loginCustomerId: z.string().nullable().optional(),
    callrailCompanyId: z.string().nullable().optional(),
    signedCaseTag: z.string().min(1).optional(),
    signedCaseNameFilters: z.array(z.string().min(1)).optional(),
  })
  .strict();

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const row = await db.query.lsaClients.findFirst({
    where: eq(lsaClients.id, id),
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
  const [row] = await db
    .update(lsaClients)
    .set({ ...parsed, updatedAt: new Date() })
    .where(eq(lsaClients.id, id))
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
    .delete(lsaClients)
    .where(eq(lsaClients.id, id))
    .returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
