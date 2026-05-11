import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { locations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { upsertDailyMetricsForToday } from "@/lib/reviews";
import { pullPerformanceForLocation } from "@/lib/performance";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected || req.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const active = await db.query.locations.findMany({
    where: eq(locations.status, "active"),
  });

  const errors: Array<{
    locationId: string;
    stage: "daily-metrics" | "performance";
    error: string;
  }> = [];
  let performancePulled = 0;

  for (const l of active) {
    try {
      await upsertDailyMetricsForToday(l.id);
    } catch (err) {
      errors.push({
        locationId: l.id,
        stage: "daily-metrics",
        error: (err as Error).message,
      });
    }

    // Best-effort: pull GBP performance only when fully connected. We don't
    // want a missing GBP link to block the daily-metrics work above.
    if (l.gbpOauthTokenId && l.gbpAccountId && l.gbpLocationId) {
      try {
        await pullPerformanceForLocation(l.id, 7);
        performancePulled++;
      } catch (err) {
        errors.push({
          locationId: l.id,
          stage: "performance",
          error: (err as Error).message,
        });
      }
    }
  }

  return NextResponse.json({
    locations: active.length,
    dailyMetricsUpdated:
      active.length - errors.filter((e) => e.stage === "daily-metrics").length,
    performancePulled,
    errors,
  });
}
