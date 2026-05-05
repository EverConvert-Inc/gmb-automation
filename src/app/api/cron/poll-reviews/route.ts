import { NextResponse } from "next/server";
import { listLocationsDueForPolling } from "@/lib/queries";
import { pollReviewsForLocation } from "@/lib/reviews";
import { postSlackAlert } from "@/lib/alerts";

export const runtime = "nodejs";
export const maxDuration = 60;

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const due = await listLocationsDueForPolling();
  let totalIngested = 0;
  let totalAlerts = 0;
  const errors: Array<{ locationId: string; error: string }> = [];

  for (const loc of due) {
    if (!loc.gbpOauthTokenId) continue;
    try {
      const result = await pollReviewsForLocation(loc.id);
      totalIngested += result.ingested;
      for (const lr of result.newLowRated) {
        await postSlackAlert({ locationName: loc.name, ...lr });
        totalAlerts++;
      }
    } catch (err) {
      errors.push({ locationId: loc.id, error: (err as Error).message });
    }
  }

  return NextResponse.json({
    locationsChecked: due.length,
    ingested: totalIngested,
    alertsSent: totalAlerts,
    errors,
  });
}
