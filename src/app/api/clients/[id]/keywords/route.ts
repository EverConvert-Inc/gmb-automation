import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { trackedKeywords } from "@/lib/db/schema";
import { METRO_LOCATIONS } from "@/lib/dataforseo";

export const runtime = "nodejs";

const createSchema = z.object({
  keyword: z.string().trim().min(1).max(200),
  targetUrl: z.string().trim().url(),
  geoCity: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  geoLat: z.number().min(-90).max(90).optional().nullable(),
  geoLng: z.number().min(-180).max(180).optional().nullable(),
  geoFormatted: z.string().trim().max(300).optional().nullable(),
});

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const { searchParams } = new URL(req.url);
  const includeInactive = searchParams.get("includeInactive") === "1";

  const where = includeInactive
    ? eq(trackedKeywords.clientId, id)
    : and(eq(trackedKeywords.clientId, id), eq(trackedKeywords.isActive, true));

  const rows = await db.query.trackedKeywords.findMany({
    where,
    orderBy: [desc(trackedKeywords.createdAt)],
  });
  return NextResponse.json({ keywords: rows });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  const { keyword, targetUrl, geoCity, geoLat, geoLng, geoFormatted } =
    parsed.data;
  // With geocoded coords we don't need a hardcoded location code, but we
  // still populate it for legacy METRO_LOCATIONS cities to keep the old
  // fallback path working (scan logic prefers coords when present).
  const geoLocationCode =
    geoCity && geoCity in METRO_LOCATIONS ? METRO_LOCATIONS[geoCity] : null;

  try {
    const [row] = await db
      .insert(trackedKeywords)
      .values({
        clientId: id,
        keyword,
        targetUrl,
        geoCity,
        geoLocationCode,
        geoLat: geoLat != null ? String(geoLat) : null,
        geoLng: geoLng != null ? String(geoLng) : null,
        geoFormatted: geoFormatted ?? null,
      })
      .returning();
    return NextResponse.json({ keyword: row }, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("tracked_keywords_unique_per_client")) {
      return NextResponse.json(
        { error: "This keyword is already tracked for this client and city." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
