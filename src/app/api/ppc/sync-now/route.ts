import { NextResponse } from "next/server";
import { z } from "zod";
import { syncAllGoogleAds, syncAllCallrail } from "@/lib/ppc-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD"),
});

// Operator-triggered resync (button on /ppc), for whatever range the
// operator currently has selected in the date filter — replaces manually
// curling the cron sync routes, including one-off backfills. Unlike
// /api/call-quality/sync-now, this also resyncs Google Ads: /ppc shows
// spend and clicks, which /call-quality doesn't.
export async function POST(req: Request) {
  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }

  const opts = { fromDate: parsed.from, toDate: parsed.to, triggeredBy: "manual" };

  const [googleAds, callrail] = await Promise.all([
    syncAllGoogleAds(opts),
    syncAllCallrail(opts),
  ]);

  return NextResponse.json({ from: parsed.from, to: parsed.to, googleAds, callrail });
}
