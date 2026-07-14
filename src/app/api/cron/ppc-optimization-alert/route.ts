import { NextResponse } from "next/server";
import { sendPpcOptimizationAlert } from "@/lib/ppc-optimization-alert";

export const runtime = "nodejs";
export const maxDuration = 300;

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

// Vercel cron entry. Fires once a day after both PPC syncs have finished,
// checks every linked client's campaigns for optimization_score < 80%, and
// emails the distribution list only if something is flagged. `?dry=1`
// returns the flagged list without sending.
export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";

  try {
    const result = await sendPpcOptimizationAlert({ dryRun });
    return NextResponse.json(result);
  } catch (err) {
    const message = (err as Error).message;
    console.error("[ppc-optimization-alert] failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
