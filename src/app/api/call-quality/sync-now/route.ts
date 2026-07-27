import { NextResponse } from "next/server";
import { z } from "zod";
import { syncAllCallrail } from "@/lib/ppc-sync";
import { syncAllLsaClients } from "@/lib/lsa-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD"),
});

// Operator-triggered resync (button on /call-quality), for whatever range
// the operator currently has selected in the date filter — replaces
// manually curling the cron routes, including one-off backfills. Only
// resyncs CallRail data: this report never reads Google Ads spend or
// conversions, so PPC's Google Ads sweep is skipped on purpose. LSA has
// no CallRail-only sync path (syncAllLsaClients always does both sources
// per client), so its Google Ads numbers get refreshed as a side effect.
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

  const [ppc, lsa] = await Promise.all([
    syncAllCallrail(opts),
    syncAllLsaClients(opts),
  ]);

  return NextResponse.json({ from: parsed.from, to: parsed.to, ppc, lsa });
}
