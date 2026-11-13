import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdsDashboardClient } from "@/lib/queries-ads-dashboard";
import { syncSearchTermsForClient } from "@/lib/ppc-search-terms-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dates must be YYYY-MM-DD");
const Body = z.object({
  ranges: z.array(z.object({ from: IsoDate, to: IsoDate })).min(1).max(2),
});

// Operator-triggered resync for one client from the Ads Dashboard: re-runs
// the same keyword/search-term sync the cron uses, for the window on
// screen and (second range) its comparison window — the daily cron only
// ever covers the trailing 30 days, so a MoM/YoY comparison window has no
// stored data until it is pulled once. Auth rides on the normal Supabase
// middleware gate.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "invalid body" },
      { status: 400 },
    );
  }
  if (!(await getAdsDashboardClient(id))) {
    return NextResponse.json({ error: "client not found" }, { status: 404 });
  }

  const results: Array<{ from: string; to: string; keywordRows: number; searchTermRows: number; campaignRows: number }> = [];
  try {
    // One range at a time: both write the same tables for the same client.
    for (const r of parsed.ranges) {
      const res = await syncSearchTermsForClient(id, {
        fromDate: r.from,
        toDate: r.to,
        triggeredBy: "manual",
      });
      results.push({
        from: r.from,
        to: r.to,
        keywordRows: res.keywordRows,
        searchTermRows: res.searchTermRows,
        campaignRows: res.campaignRows,
      });
    }
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : ((err as { errors?: Array<{ message?: string }> } | null)?.errors?.[0]?.message ??
          "sync failed");
    return NextResponse.json({ error: message, results }, { status: 502 });
  }
  return NextResponse.json({ results });
}
