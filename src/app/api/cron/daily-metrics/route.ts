import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { locations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { upsertDailyMetricsForToday } from "@/lib/reviews";

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

  const errors: Array<{ locationId: string; error: string }> = [];
  for (const l of active) {
    try {
      await upsertDailyMetricsForToday(l.id);
    } catch (err) {
      errors.push({ locationId: l.id, error: (err as Error).message });
    }
  }

  return NextResponse.json({ updated: active.length - errors.length, errors });
}
