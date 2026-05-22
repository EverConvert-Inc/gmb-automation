import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { trackedKeywords } from "@/lib/db/schema";

export const runtime = "nodejs";

const patchSchema = z.object({
  keyword: z.string().trim().min(1).max(200).optional(),
  targetUrl: z.string().trim().url().optional(),
  geoCity: z.string().trim().min(1).max(100).optional(),
  geoLat: z.number().min(-90).max(90).optional(),
  geoLng: z.number().min(-180).max(180).optional(),
  geoFormatted: z.string().trim().max(300).optional().nullable(),
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
  if (parsed.data.keyword !== undefined) updates.keyword = parsed.data.keyword;
  if (parsed.data.targetUrl !== undefined) updates.targetUrl = parsed.data.targetUrl;
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;
  if (parsed.data.geoCity !== undefined) updates.geoCity = parsed.data.geoCity;
  if (parsed.data.geoLat !== undefined) {
    updates.geoLat = parsed.data.geoLat != null ? String(parsed.data.geoLat) : null;
  }
  if (parsed.data.geoLng !== undefined) {
    updates.geoLng = parsed.data.geoLng != null ? String(parsed.data.geoLng) : null;
  }
  if (parsed.data.geoFormatted !== undefined) {
    updates.geoFormatted = parsed.data.geoFormatted ?? null;
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
