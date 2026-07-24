import { NextResponse } from "next/server";
import { z } from "zod";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ppcCallrailTagCategories } from "@/lib/db/schema";

export const runtime = "nodejs";

const CreateBody = z
  .object({
    label: z.string().min(1),
    callrailTagName: z.string().min(1),
    rollup: z.enum(["real", "junk"]),
  })
  .strict();

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const rows = await db.query.ppcCallrailTagCategories.findMany({
    where: eq(ppcCallrailTagCategories.ppcClientId, id),
    orderBy: asc(ppcCallrailTagCategories.sortOrder),
  });
  return NextResponse.json({ categories: rows });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let parsed;
  try {
    parsed = CreateBody.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }
  // New categories append to the end of the list.
  const [{ nextSortOrder }] = await db
    .select({
      nextSortOrder: sql<number>`coalesce(max(${ppcCallrailTagCategories.sortOrder}), -1) + 1`,
    })
    .from(ppcCallrailTagCategories)
    .where(eq(ppcCallrailTagCategories.ppcClientId, id));

  const [row] = await db
    .insert(ppcCallrailTagCategories)
    .values({ ppcClientId: id, ...parsed, sortOrder: nextSortOrder })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
