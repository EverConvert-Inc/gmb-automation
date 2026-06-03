import { NextResponse } from "next/server";
import { getMonthlyDataForSeoSpend } from "@/lib/dataforseo-spend";

export const runtime = "nodejs";
export const maxDuration = 60;

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

// Runs daily at 00:05 UTC. Calls getMonthlyDataForSeoSpend(), which
// fetches DataForSEO's current lifetime and inserts today's snapshot
// (idempotent via onConflictDoNothing). The reason for the cron over
// pure lazy capture: guarantees the 1st-of-each-month snapshot exists
// even if no operator opens the LVP that day. The 1st snapshot of each
// month becomes that month's MTD anchor.
export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await getMonthlyDataForSeoSpend();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = (err as Error).message;
    console.error("[dataforseo-spend-snapshot] failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
