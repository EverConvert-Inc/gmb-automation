import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { redditClients } from "@/lib/db/schema";

export const runtime = "nodejs";

// Deleting a client unmaps its accounts (FK is ON DELETE SET NULL); their
// spend history stays and shows under "Unmapped" until remapped.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [row] = await db.delete(redditClients).where(eq(redditClients.id, id)).returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ deleted: row.id });
}
