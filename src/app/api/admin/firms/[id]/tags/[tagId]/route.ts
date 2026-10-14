import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { leadFirmTags } from "@/lib/db/schema";
import { requireAdminRoute } from "@/lib/leads/admin-auth";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; tagId: string }> },
) {
  // Staff-only. Every internal route in this repo is middleware-only, which
  // cannot tell a staff member from a client user — see admin-auth.ts.
  const denied = await requireAdminRoute();
  if (denied) return denied;
  const { id, tagId } = await params;
  // Scoped to the firm as well as the row id, so a stale tab cannot delete
  // another firm's routing rule by id alone.
  const [row] = await db
    .delete(leadFirmTags)
    .where(and(eq(leadFirmTags.id, tagId), eq(leadFirmTags.firmId, id)))
    .returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
