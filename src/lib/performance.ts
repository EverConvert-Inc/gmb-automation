import { eq } from "drizzle-orm";
import { db } from "./db/client";
import { locationPerformanceDaily, locations, oauthCredentials } from "./db/schema";
import { fetchPerformanceMetrics } from "./gbp";

// Pulls the last `lookbackDays` days of Google Business Profile Performance
// data for a single location and upserts one row per (location, date, metric)
// into location_performance_daily.
//
// Google publishes performance data with a 2–3 day lag and may revise the
// last few days, so the daily cron always re-pulls a small trailing window
// (default 7d) to catch corrections. On first connect we backfill 90d.
export async function pullPerformanceForLocation(
  locationId: string,
  lookbackDays = 7,
): Promise<{ rowsWritten: number }> {
  const location = await db.query.locations.findFirst({
    where: eq(locations.id, locationId),
  });
  if (!location) throw new Error(`Location ${locationId} not found`);
  if (
    !location.gbpAccountId ||
    !location.gbpLocationId ||
    !location.gbpOauthTokenId
  ) {
    throw new Error("Location not fully connected to Google Business Profile");
  }
  const cred = await db.query.oauthCredentials.findFirst({
    where: eq(oauthCredentials.id, location.gbpOauthTokenId),
  });
  if (!cred) throw new Error("Missing OAuth credential for this location");

  const endDate = new Date();
  const startDate = new Date(Date.now() - lookbackDays * 86_400_000);

  const series = await fetchPerformanceMetrics({
    locationId: location.gbpLocationId,
    refreshTokenEncrypted: cred.refreshTokenEncrypted,
    startDate,
    endDate,
  });

  let rowsWritten = 0;
  for (const s of series) {
    for (const v of s.values) {
      await db
        .insert(locationPerformanceDaily)
        .values({
          locationId,
          metricDate: v.date,
          metric: s.metric,
          value: v.value,
        })
        .onConflictDoUpdate({
          target: [
            locationPerformanceDaily.locationId,
            locationPerformanceDaily.metricDate,
            locationPerformanceDaily.metric,
          ],
          set: { value: v.value, ingestedAt: new Date() },
        });
      rowsWritten++;
    }
  }
  return { rowsWritten };
}
