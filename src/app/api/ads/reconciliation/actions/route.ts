import { NextResponse } from "next/server";
import { getConversionActionOptions } from "@/lib/queries-google-ads-reconciliation";
import { stringifyError } from "@/lib/leads/sync";

export const runtime = "nodejs";
export const maxDuration = 60;

// The account's conversion actions for the mapping editor's dropdown.
export async function GET(req: Request) {
  const clientId = new URL(req.url).searchParams.get("clientId") ?? "";
  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }
  try {
    const result = await getConversionActionOptions(clientId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
    return NextResponse.json({ actions: result.actions });
  } catch (err) {
    return NextResponse.json({ error: stringifyError(err) }, { status: 500 });
  }
}
