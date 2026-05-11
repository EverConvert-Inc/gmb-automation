import { NextResponse } from "next/server";
import { runSerpScan } from "@/lib/serp-scan";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  try {
    const result = await runSerpScan({ triggeredBy: "manual" });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
