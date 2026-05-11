import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { locations, oauthCredentials } from "@/lib/db/schema";
import { findGbpLocationByPlaceId } from "@/lib/gbp";
import { pollReviewsForLocation } from "@/lib/reviews";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ locationId: string }> },
) {
  const { locationId } = await params;
  const location = await db.query.locations.findFirst({
    where: eq(locations.id, locationId),
  });
  if (!location) {
    return NextResponse.json({ error: "location not found" }, { status: 404 });
  }
  if (!location.gbpOauthTokenId) {
    return NextResponse.json(
      { error: "Google Business Profile not connected for this location." },
      { status: 400 },
    );
  }

  // If the placeId-to-GBP match wasn't completed at OAuth time, retry it now
  // before polling. This covers the case where the user freshly connected
  // before the discovery step was wired up.
  if (!location.gbpAccountId || !location.gbpLocationId) {
    const cred = await db.query.oauthCredentials.findFirst({
      where: eq(oauthCredentials.id, location.gbpOauthTokenId),
    });
    if (!cred) {
      return NextResponse.json(
        { error: "Stored OAuth credential missing. Reconnect Google Business Profile." },
        { status: 400 },
      );
    }
    try {
      const match = await findGbpLocationByPlaceId({
        refreshTokenEncrypted: cred.refreshTokenEncrypted,
        placeId: location.placeId,
      });
      if (!match) {
        return NextResponse.json(
          {
            error:
              "No GBP location matching this place was found under the connected Google account.",
          },
          { status: 404 },
        );
      }
      await db
        .update(locations)
        .set({ gbpAccountId: match.accountId, gbpLocationId: match.locationId })
        .where(eq(locations.id, locationId));
    } catch (err) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 502 },
      );
    }
  }

  try {
    const result = await pollReviewsForLocation(locationId);
    return NextResponse.json({ ingested: result.ingested });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 },
    );
  }
}
