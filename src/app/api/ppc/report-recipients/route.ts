import { NextResponse } from "next/server";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ppcReportRecipients } from "@/lib/db/schema";

export const runtime = "nodejs";

const CreateBody = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export async function GET() {
  const rows = await db.query.ppcReportRecipients.findMany({
    orderBy: asc(ppcReportRecipients.email),
  });
  return NextResponse.json({ recipients: rows });
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
  const existing = await db.query.ppcReportRecipients.findFirst({
    where: eq(ppcReportRecipients.email, parsed.email),
  });
  if (existing) {
    return NextResponse.json(
      { error: "That email is already on the recipient list" },
      { status: 409 },
    );
  }
  const [row] = await db
    .insert(ppcReportRecipients)
    .values({ email: parsed.email })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
