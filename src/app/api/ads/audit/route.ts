import { NextResponse } from "next/server";
import { getAccountCampaignSettings } from "@/lib/queries-ads-dashboard";
import { stringifyError } from "@/lib/leads/sync";

export const runtime = "nodejs";
export const maxDuration = 60;

// Live campaign settings for one account, fetched when an account row on
// /ads/audit is expanded. Behind the normal Supabase middleware gate.
export async function GET(req: Request) {
  const clientId = new URL(req.url).searchParams.get("clientId") ?? "";
  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }
  try {
    const campaigns = await getAccountCampaignSettings(clientId);
    return NextResponse.json({ campaigns });
  } catch (err) {
    return NextResponse.json({ error: stringifyError(err) }, { status: 500 });
  }
}
