import { NextResponse } from "next/server";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ppcClients } from "@/lib/db/schema";

export const runtime = "nodejs";

const Slug = z
  .string()
  .min(1)
  .regex(/^[a-z0-9-]+$/, "slug must be lowercase letters, digits, dashes");

const CreateBody = z.object({
  name: z.string().min(1),
  slug: Slug,
});

export async function GET() {
  const rows = await db.query.ppcClients.findMany({
    orderBy: asc(ppcClients.name),
  });
  return NextResponse.json({ clients: rows });
}

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = CreateBody.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }
  const existing = await db.query.ppcClients.findFirst({
    where: eq(ppcClients.slug, parsed.slug),
  });
  if (existing) {
    return NextResponse.json(
      { error: "A PPC client with this slug already exists" },
      { status: 409 },
    );
  }
  const [row] = await db
    .insert(ppcClients)
    .values({ name: parsed.name, slug: parsed.slug })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
