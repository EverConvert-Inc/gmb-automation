import { NextResponse } from "next/server";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { leadNotes, leads } from "@/lib/db/schema";
import { checkAdmin, requireAdminRoute } from "@/lib/leads/admin-auth";

export const runtime = "nodejs";

const CreateBody = z.object({ body: z.string().min(1).max(4000) }).strict();

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const denied = await requireAdminRoute();
  if (denied) return denied;

  const { leadId } = await params;
  const rows = await db.query.leadNotes.findMany({
    where: eq(leadNotes.leadId, leadId),
    orderBy: asc(leadNotes.createdAt),
  });
  return NextResponse.json({ notes: rows });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const auth = await checkAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { leadId } = await params;
  let parsed;
  try {
    parsed = CreateBody.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  const lead = await db.query.leads.findFirst({ where: eq(leads.id, leadId) });
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });

  // lead_notes.firm_id is NOT NULL — it is denormalised so every portal query
  // can filter notes on the firm without a join, which is what stops a
  // dropped join leaking one firm's notes to another. The cost is that a
  // lead with no firm cannot carry a note at all. Refused with the reason
  // rather than failing on the constraint.
  if (!lead.firmId) {
    return NextResponse.json(
      {
        error:
          "This lead has no firm yet, and a note has to belong to one. Route it to a firm first — add a matching tag or company mapping, then re-sync.",
      },
      { status: 409 },
    );
  }

  const [row] = await db
    .insert(leadNotes)
    .values({
      leadId,
      firmId: lead.firmId,
      authorKind: "staff",
      authorEmail: auth.email,
      body: parsed.body.trim(),
    })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
