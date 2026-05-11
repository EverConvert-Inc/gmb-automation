import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { trackedKeywords } from "@/lib/db/schema";
import { METRO_LOCATIONS } from "@/lib/dataforseo";

export const runtime = "nodejs";

const patchSchema = z.object({
  targetUrl: z.string().trim().url().optional(),
  geoCity: z.string().trim().min(1).max(100).optional().nullable(),
  isActive: z.boolean().optional(),
});

const UUID = /^[0-9a-f-]{36}$/i;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; keywordId: string }> },
) {
  const { id, keywordId } = await params;
  if (!UUID.test(id) || !UUID.test(keywordId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.targetUrl !== undefined) updates.targetUrl = parsed.data.targetUrl;
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;
  if (parsed.data.geoCity !== undefined) {
    const city = parsed.data.geoCity;
    if (city && !(city in METRO_LOCATIONS)) {
      return NextResponse.json(
        { error: `Unknown city '${city}'.` },
        { status: 400 },
      );
    }
    updates.geoCity = city ?? null;
    updates.geoLocationCode = city ? METRO_LOCATIONS[city] : null;
  }

  const [row] = await db
    .update(trackedKeywords)
    .set(updates)
    .where(
      and(eq(trackedKeywords.id, keywordId), eq(trackedKeywords.clientId, id)),
    )
    .returning();
  if (!row) {
    return NextResponse.json({ error: "keyword not found" }, { status: 404 });
  }
  return NextResponse.json({ keyword: row });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; keywordId: string }> },
) {
  const { id, keywordId } = await params;
  if (!UUID.test(id) || !UUID.test(keywordId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const { searchParams } = new URL(req.url);
  const hard = searchParams.get("hard") === "1";

  if (hard) {
    const result = await db
      .delete(trackedKeywords)
      .where(
        and(eq(trackedKeywords.id, keywordId), eq(trackedKeywords.clientId, id)),
      )
      .returning({ id: trackedKeywords.id });
    if (result.length === 0) {
      return NextResponse.json({ error: "keyword not found" }, { status: 404 });
    }
    return NextResponse.json({ deleted: result[0].id });
  }

  const [row] = await db
    .update(trackedKeywords)
    .set({ isActive: false, updatedAt: new Date() })
    .where(
      and(eq(trackedKeywords.id, keywordId), eq(trackedKeywords.clientId, id)),
    )
    .returning();
  if (!row) {
    return NextResponse.json({ error: "keyword not found" }, { status: 404 });
  }
  return NextResponse.json({ keyword: row });
}
