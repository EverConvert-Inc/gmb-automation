import { NextResponse } from "next/server";
import { daysAgoIsoEastern, yesterdayIsoEastern } from "@/lib/date-utils";
import { SEARCH_TERMS_TRAILING_DAYS, syncAllSearchTerms } from "@/lib/ppc-search-terms-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

// Keyword + search-term sync. Re-pulls the trailing 30 Eastern days through
// yesterday on every run (not yesterday alone like ppc-google-ads-sync),
// because conversions are credited back to the click date and keep rising.
//
// Scheduled at 11:50 UTC in vercel.json: 7:50am Eastern under EDT, 6:50am
// under EST (Vercel cron has no time zone support).
export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const fromDate = daysAgoIsoEastern(SEARCH_TERMS_TRAILING_DAYS);
  const toDate = yesterdayIsoEastern();
  const result = await syncAllSearchTerms({ fromDate, toDate, triggeredBy: "scheduled" });
  return NextResponse.json({ fromDate, toDate, ...result });
}
