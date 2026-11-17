import { NextResponse } from "next/server";
import { runWhatsappDiscovery } from "@/lib/whatsapp-inbox";

export const runtime = "nodejs";
export const maxDuration = 60;

// "Refresh from Meta" on /whatsapp/numbers.
export async function POST() {
  try {
    return NextResponse.json(await runWhatsappDiscovery());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
