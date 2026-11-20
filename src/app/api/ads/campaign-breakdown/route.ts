import { NextResponse } from "next/server";
import { getCampaignBreakdown, getPmaxCampaignBreakdown } from "@/lib/queries-ads-dashboard";
import { stringifyError } from "@/lib/leads/sync";

export const runtime = "nodejs";
export const maxDuration = 60;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Live breakdown for one campaign, fetched when a row on /ads/overview is
// expanded. Search campaigns return ad groups → ads; Performance Max returns
// asset groups → assets (it has no ad groups). Behind the normal Supabase
// middleware gate (an operator route, not a cron) — no CRON_SECRET.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId") ?? "";
  const campaignId = url.searchParams.get("campaignId") ?? "";
  const type = url.searchParams.get("type") ?? "";
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";

  if (!clientId || !/^\d+$/.test(campaignId) || !DATE.test(from) || !DATE.test(to)) {
    return NextResponse.json(
      { error: "clientId, a numeric campaignId, and from/to (YYYY-MM-DD) are required" },
      { status: 400 },
    );
  }

  try {
    if (type === "PERFORMANCE_MAX") {
      const { groups, assetsError } = await getPmaxCampaignBreakdown(clientId, campaignId, { from, to });
      return NextResponse.json({ kind: "pmax", assetGroups: groups, assetsError });
    }
    const adGroups = await getCampaignBreakdown(clientId, campaignId, { from, to });
    return NextResponse.json({ kind: "search", adGroups });
  } catch (err) {
    return NextResponse.json({ error: stringifyError(err) }, { status: 500 });
  }
}
