import { NextResponse } from "next/server";
import { daysAgoIsoEastern, yesterdayIsoEastern } from "@/lib/date-utils";
import { syncAllRedditSpend } from "@/lib/reddit-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

// Reddit metrics can keep changing for up to 6 hours, so each daily run
// re-pulls a trailing window (the last 3 Eastern days through yesterday)
// rather than yesterday alone like the PPC cron.
const TRAILING_DAYS = 3;

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

// Scheduled at 11:25 UTC in vercel.json: 7:25am Eastern under EDT, 6:25am
// under EST (Vercel cron has no time zone support).
export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const fromDate = daysAgoIsoEastern(TRAILING_DAYS);
  const toDate = yesterdayIsoEastern();
  try {
    const result = await syncAllRedditSpend({ fromDate, toDate, triggeredBy: "scheduled" });
    return NextResponse.json({ fromDate, toDate, ...result });
  } catch (err) {
    return NextResponse.json(
      { fromDate, toDate, error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
