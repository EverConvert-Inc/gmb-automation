import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { gridConfigs, keywords, locations } from "@/lib/db/schema";
import { getPlaceDetails } from "@/lib/places";

export const runtime = "nodejs";

const Body = z.object({
  clientId: z.string().uuid(),
  name: z.string().min(1),
  address: z.string().min(1),
  placeId: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
  keywords: z.array(z.string().min(1)).min(1),
  gridSize: z.union([z.literal(3), z.literal(5), z.literal(7), z.literal(9), z.literal(11), z.literal(13)]).default(11),
  radiusMiles: z.number().positive().default(5),
});

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  // Pull public Place metadata at creation time so the dashboard has
  // something to show before GBP OAuth completes (website, rating,
  // review count, Maps link). Best-effort — falls back to nulls if the
  // Places call fails.
  let placeMeta: {
    websiteUri: string | null;
    rating: number | null;
    userRatingCount: number | null;
    googleMapsUri: string | null;
  } = {
    websiteUri: null,
    rating: null,
    userRatingCount: null,
    googleMapsUri: null,
  };
  try {
    const details = await getPlaceDetails(parsed.placeId);
    if (details) {
      placeMeta = {
        websiteUri: details.websiteUri,
        rating: details.rating,
        userRatingCount: details.userRatingCount,
        googleMapsUri: details.googleMapsUri,
      };
    }
  } catch (err) {
    console.warn(`[locations] place details fetch failed:`, (err as Error).message);
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
        placeWebsiteUri: placeMeta.websiteUri,
        placeRating:
          placeMeta.rating != null ? String(placeMeta.rating) : null,
        placeReviewCount: placeMeta.userRatingCount,
        placeGoogleMapsUri: placeMeta.googleMapsUri,
        placeRefreshedAt: new Date(),
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
