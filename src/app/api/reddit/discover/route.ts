import { NextResponse } from "next/server";
import { runRedditDiscovery } from "@/lib/reddit-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

// "Refresh accounts" on /reddit/accounts: discovery only, no spend pull.
export async function POST() {
  try {
    return NextResponse.json(await runRedditDiscovery("manual"));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
