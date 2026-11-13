import { NextResponse } from "next/server";
import { daysAgoIsoEastern, yesterdayIsoEastern } from "@/lib/date-utils";
import {
  SEARCH_TERMS_TRAILING_DAYS,
  parseClientBatch,
  syncAllSearchTerms,
} from "@/lib/ppc-search-terms-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BACKFILL_DAYS = 800;

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

// Keyword + search-term + Search-campaign-total sync. Re-pulls the trailing
// 30 Eastern days through yesterday on every run (not yesterday alone like
// ppc-google-ads-sync), because conversions are credited back to the click
// date and keep rising.
//
// Scheduled at 11:50 UTC in vercel.json: 7:50am Eastern under EDT, 6:50am
// under EST (Vercel cron has no time zone support).
//
// One-off backfill (the WoW/MoM/YoY comparisons need history the daily
// 30-day window never reaches): ?days=<n> widens the window, up to 800.
//
// A long window across every client can outrun the 300-second limit, so a
// backfill is run in client groups: ?days=400&offset=0&limit=8, then repeat
// with the returned nextOffset until it is null. Clients are in a fixed
// order, each one is replaced per window in its own transaction, and a
// group can be re-run safely. `clients[].seconds` shows how long each took;
// if a request is killed at the limit, re-run that offset with a smaller
// limit. Without offset/limit (the scheduled run) every client is synced.
export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const params = new URL(req.url).searchParams;
  const parsed = parseClientBatch(params.get("offset"), params.get("limit"));
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const daysParam = Number(params.get("days"));
  const days =
    Number.isInteger(daysParam) && daysParam > 0
      ? Math.min(daysParam, MAX_BACKFILL_DAYS)
      : SEARCH_TERMS_TRAILING_DAYS;
  const fromDate = daysAgoIsoEastern(days);
  const toDate = yesterdayIsoEastern();
  const result = await syncAllSearchTerms({
    fromDate,
    toDate,
    batch: parsed.batch,
    triggeredBy: days === SEARCH_TERMS_TRAILING_DAYS ? "scheduled" : "backfill",
  });
  return NextResponse.json({ fromDate, toDate, days, limit: parsed.batch?.limit ?? null, ...result });
}
