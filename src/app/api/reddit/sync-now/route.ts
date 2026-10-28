import { NextResponse } from "next/server";
import { z } from "zod";
import { syncAllRedditSpend } from "@/lib/reddit-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
const Body = z
  .object({ from: IsoDate, to: IsoDate })
  .refine((b) => b.from <= b.to, "from must not be after to");

// Operator-triggered resync (button on /reddit) for whatever range the date
// filter shows. Re-runs discovery and then the same per-account pull the
// daily cron uses.
export async function POST(req: Request) {
  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  try {
    const result = await syncAllRedditSpend({
      fromDate: parsed.from,
      toDate: parsed.to,
      triggeredBy: "manual",
    });
    return NextResponse.json({ from: parsed.from, to: parsed.to, ...result });
  } catch (err) {
    // Not connected, or the token refresh itself failed.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
