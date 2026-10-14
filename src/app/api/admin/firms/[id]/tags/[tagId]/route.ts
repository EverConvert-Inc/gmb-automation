import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { leadFirmTags } from "@/lib/db/schema";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; tagId: string }> },
) {
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
