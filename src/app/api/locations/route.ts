import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { gridConfigs, keywords, locations } from "@/lib/db/schema";

export const runtime = "nodejs";

const Body = z.object({
  clientId: z.string().uuid(),
  name: z.string().min(1),
  address: z.string().min(1),
  placeId: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
  keywords: z.array(z.string().min(1)).min(1),
  gridSize: z.union([z.literal(3), z.literal(5), z.literal(7), z.literal(9), z.literal(11), z.literal(13)]).default(7),
  radiusMiles: z.number().positive().default(5),
});

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  try {
    const [location] = await db
      .insert(locations)
      .values({
        clientId: parsed.clientId,
        name: parsed.name,
        address: parsed.address,
        placeId: parsed.placeId,
        lat: parsed.lat.toFixed(7),
        lng: parsed.lng.toFixed(7),
        status: "active",
        pollFrequency: "daily",
      })
      .returning();

    await db.insert(keywords).values(
      parsed.keywords.map((kw, idx) => ({
        locationId: location.id,
        keyword: kw,
        isPrimary: idx === 0,
      })),
    );

    await db.insert(gridConfigs).values({
      locationId: location.id,
      name: `${parsed.radiusMiles} mile, ${parsed.gridSize}x${parsed.gridSize}`,
      size: parsed.gridSize,
      radiusMiles: parsed.radiusMiles.toFixed(2),
      isDefault: true,
    });

    return NextResponse.json(location, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
