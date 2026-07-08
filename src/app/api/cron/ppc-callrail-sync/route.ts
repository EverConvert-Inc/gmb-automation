import { NextResponse } from "next/server";
import { syncAllCallrail, yesterdayIso } from "@/lib/ppc-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Backfill mode: explicit ?from=&to= range for recovering missed days
  // (e.g. after a CallRail API key outage) without waiting on the daily
  // single-day cron. Vercel's cron invocation never sets these params, so
  // the scheduled path below is unchanged.
  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  if (fromParam || toParam) {
    if (!fromParam || !toParam || !DATE_RE.test(fromParam) || !DATE_RE.test(toParam)) {
      return NextResponse.json(
        { error: "backfill requires both ?from=YYYY-MM-DD and ?to=YYYY-MM-DD" },
        { status: 400 },
      );
    }
    const result = await syncAllCallrail({
      fromDate: fromParam,
      toDate: toParam,
      triggeredBy: "manual-backfill",
    });
    return NextResponse.json({ from: fromParam, to: toParam, ...result });
  }

  const date = yesterdayIso();
  const result = await syncAllCallrail({
    fromDate: date,
    toDate: date,
    triggeredBy: "scheduled",
  });
  return NextResponse.json({ date, ...result });
}
