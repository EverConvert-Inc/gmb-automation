import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { leadFirmCallrailCompanies } from "@/lib/db/schema";
import { requireAdminRoute } from "@/lib/leads/admin-auth";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; mappingId: string }> },
) {
  // Staff-only. Every internal route in this repo is middleware-only, which
  // cannot tell a staff member from a client user — see admin-auth.ts.
  const denied = await requireAdminRoute();
  if (denied) return denied;
  const { id, mappingId } = await params;
  const [row] = await db
    .delete(leadFirmCallrailCompanies)
    .where(
      and(
        eq(leadFirmCallrailCompanies.id, mappingId),
        eq(leadFirmCallrailCompanies.firmId, id),
      ),
    )
    .returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
