import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ppcCallrailTagCategories } from "@/lib/db/schema";

export const runtime = "nodejs";

const PatchBody = z
  .object({
    label: z.string().min(1).optional(),
    callrailTagName: z.string().min(1).optional(),
    rollup: z.enum(["real", "junk"]).optional(),
    sortOrder: z.number().int().optional(),
  })
  .strict();

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; categoryId: string }> },
) {
  const { id, categoryId } = await params;
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
    .update(ppcCallrailTagCategories)
    .set(parsed)
    .where(
      and(
        eq(ppcCallrailTagCategories.id, categoryId),
        eq(ppcCallrailTagCategories.ppcClientId, id),
      ),
    )
    .returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; categoryId: string }> },
) {
  const { id, categoryId } = await params;
  const [row] = await db
    .delete(ppcCallrailTagCategories)
    .where(
      and(
        eq(ppcCallrailTagCategories.id, categoryId),
        eq(ppcCallrailTagCategories.ppcClientId, id),
      ),
    )
    .returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
