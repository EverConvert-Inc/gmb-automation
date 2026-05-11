import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { locations, oauthCredentials } from "@/lib/db/schema";
import { findGbpLocationByPlaceId } from "@/lib/gbp";
import { pullPerformanceForLocation } from "@/lib/performance";
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
  // before polling. Covers locations that connected before the discovery
  // step was wired up.
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

  let ingested = 0;
  let performanceRows = 0;
  let performanceError: string | null = null;

  try {
    const reviewResult = await pollReviewsForLocation(locationId);
    ingested = reviewResult.ingested;
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 },
    );
  }

  // Performance pull is best-effort: if Google hasn't published metrics yet
  // for this listing (common in the first few days) we still want the review
  // sync to succeed. Use a 90d window so the dashboard's MoM comparison has
  // a prior window to compare against if available.
  try {
    const perfResult = await pullPerformanceForLocation(locationId, 90);
    performanceRows = perfResult.rowsWritten;
  } catch (err) {
    console.error("[sync-reviews] performance pull failed:", err);
    performanceError = (err as Error).message;
  }

  return NextResponse.json({
    ingested,
    performanceRows,
    performanceError,
  });
}
