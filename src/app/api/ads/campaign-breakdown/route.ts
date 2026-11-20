import { NextResponse } from "next/server";
import { getCampaignBreakdown } from "@/lib/queries-ads-dashboard";

export const runtime = "nodejs";
export const maxDuration = 60;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Live ad group + ad breakdown for one campaign, fetched when a row on
// /ads/overview is expanded. Behind the normal Supabase middleware gate (an
// operator route, not a cron) — no CRON_SECRET.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId") ?? "";
  const campaignId = url.searchParams.get("campaignId") ?? "";
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";

  if (!clientId || !/^\d+$/.test(campaignId) || !DATE.test(from) || !DATE.test(to)) {
    return NextResponse.json(
      { error: "clientId, a numeric campaignId, and from/to (YYYY-MM-DD) are required" },
      { status: 400 },
    );
  }

  try {
    const adGroups = await getCampaignBreakdown(clientId, campaignId, { from, to });
    return NextResponse.json({ adGroups });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
