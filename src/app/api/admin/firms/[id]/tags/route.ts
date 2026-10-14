import { NextResponse } from "next/server";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { leadFirmTags, leadFirms } from "@/lib/db/schema";
import {
  PG_UNIQUE_VIOLATION,
  normalizeTagName,
  pgErrorCode,
} from "@/lib/leads/firm-admin";

export const runtime = "nodejs";

const CreateBody = z.object({ tagName: z.string().min(1) }).strict();

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const rows = await db.query.leadFirmTags.findMany({
    where: eq(leadFirmTags.firmId, id),
    orderBy: asc(leadFirmTags.tagNameLower),
  });
  return NextResponse.json({ tags: rows });
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
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  const firm = await db.query.leadFirms.findFirst({ where: eq(leadFirms.id, id) });
  if (!firm) return NextResponse.json({ error: "not found" }, { status: 404 });

  // The pair is not independent: lead_firm_tags CHECKs that
  // tag_name_lower = lower(tag_name), and the normaliser is what keeps the
  // stored value identical to the one routing.ts matches on.
  const { tagName, tagNameLower } = normalizeTagName(parsed.tagName);
  if (!tagName) {
    return NextResponse.json({ error: "Tag name is empty." }, { status: 400 });
  }

  try {
    const [row] = await db
      .insert(leadFirmTags)
      .values({ firmId: id, tagName, tagNameLower })
      .returning();
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    // unique(firm_id, tag_name_lower). Deliberately scoped to the firm: the
    // same tag on several firms is a supported configuration — routing rule
    // 1 copies a matching lead to each of them.
    if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
      return NextResponse.json(
        { error: `This firm already routes on "${tagName}".` },
        { status: 409 },
      );
    }
    throw err;
  }
}
