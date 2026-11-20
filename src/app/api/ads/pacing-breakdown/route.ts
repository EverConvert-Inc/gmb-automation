import { NextResponse } from "next/server";
import { getCampaignPacing } from "@/lib/queries-ads-dashboard";
import { stringifyError } from "@/lib/leads/sync";

export const runtime = "nodejs";
export const maxDuration = 60;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Live per-campaign pacing for one account, fetched when an account row on
// /ads/pacing is expanded. Behind the normal Supabase middleware gate.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId") ?? "";
  const monthStart = url.searchParams.get("monthStart") ?? "";

  if (!clientId || !DATE.test(monthStart)) {
    return NextResponse.json({ error: "clientId and monthStart (YYYY-MM-DD) are required" }, { status: 400 });
  }

  try {
    const campaigns = await getCampaignPacing(clientId, monthStart);
    return NextResponse.json({ campaigns });
  } catch (err) {
    return NextResponse.json({ error: stringifyError(err) }, { status: 500 });
  }
}
