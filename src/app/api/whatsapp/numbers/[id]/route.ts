import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { whatsappNumbers } from "@/lib/db/schema";

export const runtime = "nodejs";

// Only our side of the row is editable; Meta-side fields belong to discovery.
const PatchBody = z
  .object({
    label: z
      .string()
      .trim()
      .max(120)
      .transform((s) => (s === "" ? null : s))
      .nullable()
      .optional(),
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
  const [row] = await db
    .update(whatsappNumbers)
    .set({ ...parsed, updatedAt: new Date() })
    .where(eq(whatsappNumbers.id, id))
    .returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}
