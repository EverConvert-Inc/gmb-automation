import { NextResponse } from "next/server";
import { getAccountCampaignSettings } from "@/lib/queries-ads-dashboard";
import { getStandards } from "@/lib/queries-google-ads-standards";
import { evaluateCompliance } from "@/lib/ads-standards";
import { stringifyError } from "@/lib/leads/sync";

export const runtime = "nodejs";
export const maxDuration = 60;

// Live campaign settings for one account, scored against the saved standards,
// fetched when an account row on /ads/audit is expanded. Behind the normal
// Supabase middleware gate.
export async function GET(req: Request) {
  const clientId = new URL(req.url).searchParams.get("clientId") ?? "";
  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }
  try {
    const [campaigns, standards] = await Promise.all([getAccountCampaignSettings(clientId), getStandards()]);
    const { verdicts, summary } = evaluateCompliance(campaigns, standards);
    return NextResponse.json({ campaigns, verdicts, summary });
  } catch (err) {
    return NextResponse.json({ error: stringifyError(err) }, { status: 500 });
  }
}
