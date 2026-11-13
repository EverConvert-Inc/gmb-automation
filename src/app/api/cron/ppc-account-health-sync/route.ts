import { NextResponse } from "next/server";
import { yesterdayIsoEastern } from "@/lib/date-utils";
import { syncAllAccountHealth } from "@/lib/ppc-account-health-sync";
import { parseClientBatch } from "@/lib/ppc-search-terms-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

// Account-health snapshot for the /ads overview: budgets and pacing,
// account-level impression share lost to budget and rank, optimization
// score and the conversion audit's junk share, month to date through
// yesterday (Eastern), one row per client in ppc_account_health_daily.
//
// Scheduled at 11:55 UTC in vercel.json: 7:55am Eastern under EDT, 6:55am
// under EST (Vercel cron has no time zone support) — after the PPC Google
// Ads, CallRail and search-terms syncs, whose stored rows the overview
// reads next to this snapshot.
//
// Safe to re-run: it upserts the one row for that client and day. If the
// client list ever outgrows the 300-second limit, run it in groups with
// ?offset=0&limit=8 and follow the returned nextOffset, as with the
// search-terms backfill.
export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const params = new URL(req.url).searchParams;
  const parsed = parseClientBatch(params.get("offset"), params.get("limit"));
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const through = yesterdayIsoEastern();
  const result = await syncAllAccountHealth({
    through,
    batch: parsed.batch,
    triggeredBy: parsed.batch ? "manual" : "scheduled",
  });
  return NextResponse.json({ through, limit: parsed.batch?.limit ?? null, ...result });
}
