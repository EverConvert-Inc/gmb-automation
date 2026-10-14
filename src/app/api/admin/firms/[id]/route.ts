import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { leadFirms, leads } from "@/lib/db/schema";
import { PG_UNIQUE_VIOLATION, pgErrorCode, slugify } from "@/lib/leads/firm-admin";

export const runtime = "nodejs";

const PatchBody = z
  .object({
    name: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const row = await db.query.leadFirms.findFirst({ where: eq(leadFirms.id, id) });
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
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.name !== undefined) update.name = parsed.name.trim();
  if (parsed.isActive !== undefined) update.isActive = parsed.isActive;
  if (parsed.slug !== undefined) {
    const slug = slugify(parsed.slug);
    if (!slug) {
      return NextResponse.json({ error: "That slug is empty once normalised." }, { status: 400 });
    }
    update.slug = slug;
  }

  try {
    const [row] = await db
      .update(leadFirms)
      .set(update)
      .where(eq(leadFirms.id, id))
      .returning();
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
      return NextResponse.json(
        { error: `The slug "${update.slug}" is already taken.` },
        { status: 409 },
      );
    }
    throw err;
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // leads.firm_id is ON DELETE RESTRICT, so this would fail at the database
  // anyway. Counting first turns an opaque FK error into a message that says
  // what to do about it — and the restrict is deliberate: deleting a firm
  // must never silently destroy its lead history.
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(eq(leads.firmId, id));
  if (n > 0) {
    return NextResponse.json(
      {
        error: `This firm still owns ${n} lead${n === 1 ? "" : "s"}. Reassign or remove them before deleting the firm, or deactivate it instead.`,
      },
      { status: 409 },
    );
  }

  const [row] = await db.delete(leadFirms).where(eq(leadFirms.id, id)).returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
