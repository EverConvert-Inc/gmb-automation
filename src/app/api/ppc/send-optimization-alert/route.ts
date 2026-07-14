import { NextResponse } from "next/server";
import { sendPpcOptimizationAlert } from "@/lib/ppc-optimization-alert";

export const runtime = "nodejs";
export const maxDuration = 300;

// Operator-triggered send (button on /ppc). Same orchestration as the
// 10:15 UTC cron — a real send, not a dry run. Auth comes from the
// Supabase middleware — no CRON_SECRET exposed to the browser.
export async function POST() {
  try {
    const result = await sendPpcOptimizationAlert();
    return NextResponse.json(result);
  } catch (err) {
    const message = (err as Error).message;
    console.error("[ppc/send-optimization-alert] failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
