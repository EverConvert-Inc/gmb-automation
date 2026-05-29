import { NextResponse } from "next/server";
import { syncAllGoogleAds, yesterdayIso } from "@/lib/ppc-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

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
  const date = yesterdayIso();
  const result = await syncAllGoogleAds({
    fromDate: date,
    toDate: date,
    triggeredBy: "scheduled",
  });
  return NextResponse.json({ date, ...result });
}
