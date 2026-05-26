import { NextResponse } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { locations, oauthCredentials } from "@/lib/db/schema";
import { dispatchWithConcurrency } from "@/lib/dataforseo";
import { findGbpLocationByPlaceId } from "@/lib/gbp";
import { pullPerformanceForLocation } from "@/lib/performance";
import { pollReviewsForLocation } from "@/lib/reviews";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYNC_CONCURRENCY = 3;

type LocationResult = {
  locationId: string;
  locationName: string;
  ingested: number;
  performanceRows: number;
  performanceError: string | null;
  error: string | null;
};

async function syncOneLocation(
  loc: typeof locations.$inferSelect,
): Promise<LocationResult> {
  const result: LocationResult = {
    locationId: loc.id,
    locationName: loc.name,
    ingested: 0,
    performanceRows: 0,
    performanceError: null,
    error: null,
  };

  // Backfill GBP account/location IDs if missing (covers locations that
  // connected before the discovery step was wired up).
  if (!loc.gbpAccountId || !loc.gbpLocationId) {
    if (!loc.gbpOauthTokenId) {
      result.error = "GBP not connected";
      return result;
    }
    const cred = await db.query.oauthCredentials.findFirst({
      where: eq(oauthCredentials.id, loc.gbpOauthTokenId),
    });
    if (!cred) {
      result.error = "OAuth credential missing — reconnect GBP";
      return result;
    }
    try {
      const match = await findGbpLocationByPlaceId({
        refreshTokenEncrypted: cred.refreshTokenEncrypted,
        placeId: loc.placeId,
      });
      if (!match) {
        result.error = "No GBP listing matching this place under the connected account";
        return result;
      }
      await db
        .update(locations)
        .set({ gbpAccountId: match.accountId, gbpLocationId: match.locationId })
        .where(eq(locations.id, loc.id));
    } catch (err) {
      result.error = `GBP discovery failed: ${(err as Error).message}`;
      return result;
    }
  }

  try {
    const r = await pollReviewsForLocation(loc.id, { full: true });
    result.ingested = r.ingested;
  } catch (err) {
    result.error = (err as Error).message;
    return result;
  }

  try {
    const p = await pullPerformanceForLocation(loc.id, 90);
    result.performanceRows = p.rowsWritten;
  } catch (err) {
    result.performanceError = (err as Error).message;
  }

  return result;
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const locs = await db.query.locations.findMany({
    where: and(
      eq(locations.clientId, id),
      isNotNull(locations.gbpOauthTokenId),
    ),
  });

  if (locs.length === 0) {
    return NextResponse.json({
      locationsProcessed: 0,
      ingested: 0,
      performanceRows: 0,
      errors: [],
      results: [],
    });
  }

  const settled = await dispatchWithConcurrency(
    locs,
    SYNC_CONCURRENCY,
    syncOneLocation,
  );

  const results: LocationResult[] = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status === "fulfilled") {
      results.push(s.value);
    } else {
      results.push({
        locationId: locs[i].id,
        locationName: locs[i].name,
        ingested: 0,
        performanceRows: 0,
        performanceError: null,
        error: (s.reason as Error)?.message ?? String(s.reason),
      });
    }
  }

  const ingested = results.reduce((a, r) => a + r.ingested, 0);
  const performanceRows = results.reduce((a, r) => a + r.performanceRows, 0);
  const errors = results
    .filter((r) => r.error != null)
    .map((r) => ({ locationName: r.locationName, error: r.error! }));

  return NextResponse.json({
    locationsProcessed: results.length,
    ingested,
    performanceRows,
    errors,
    results,
  });
}
