import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { redditAdAccounts, redditClients } from "@/lib/db/schema";

export const runtime = "nodejs";

// Only our side of the row is editable; Reddit-side fields (name, currency,
// owner business) are owned by discovery.
const PatchBody = z
  .object({
    redditClientId: z.string().uuid().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let parsed;
  try {
    parsed = PatchBody.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  if (parsed.redditClientId) {
    const client = await db.query.redditClients.findFirst({
      where: eq(redditClients.id, parsed.redditClientId),
    });
    if (!client) return NextResponse.json({ error: "Reddit client not found" }, { status: 404 });
  }
  const [row] = await db
    .update(redditAdAccounts)
    .set({ ...parsed, updatedAt: new Date() })
    .where(eq(redditAdAccounts.id, id))
    .returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}
