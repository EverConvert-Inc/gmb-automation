import { NextResponse } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { lsaClients } from "@/lib/db/schema";
import { runLeadRatingDryRun, emptyCounts, type DryRunCounts } from "@/lib/lsa-lead-rating";

export const runtime = "nodejs";
export const maxDuration = 300;

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

// DRY RUN ONLY. Produces, for every unrated LSA lead, either a proposed
// rating with its reasoning or the reason it could not be judged, and
// records both. NOTHING is sent to Google — ProvideLeadFeedback is never
// called from here or from anything it imports.
//
// Not registered in vercel.json: this costs Gemini tokens and reads legal
// intake conversations, so it runs only when someone triggers it.
//
// Usage: ?customerId=<google ads customer id>[&days=30][&limit=50]
//        ?all=true  to sweep every active LSA client
export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY not set — nothing can be classified" },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const customerId = url.searchParams.get("customerId");
  const all = url.searchParams.get("all") === "true";
  const days = Number(url.searchParams.get("days") ?? "30");
  const limit = Number(url.searchParams.get("limit") ?? "50");
  if (!customerId && !all) {
    return NextResponse.json(
      { error: "?customerId= or ?all=true is required" },
      { status: 400 },
    );
  }

  const toDate = new Date().toISOString().slice(0, 10);
  const fromDate = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const clients = await db.query.lsaClients.findMany({
    where: and(
      eq(lsaClients.isActive, true),
      isNotNull(lsaClients.googleAdsCustomerId),
      isNotNull(lsaClients.googleAdsOauthTokenId),
      customerId ? eq(lsaClients.googleAdsCustomerId, customerId) : undefined,
    ),
  });
  if (clients.length === 0) {
    return NextResponse.json({ error: "no matching LSA clients" }, { status: 404 });
  }

  const perClient: Array<Record<string, unknown>> = [];
  const totals: DryRunCounts = emptyCounts();

  for (const c of clients) {
    try {
      const { counts, errors } = await runLeadRatingDryRun(c.id, { fromDate, toDate, limit });
      perClient.push({ client: c.name, customerId: c.googleAdsCustomerId, counts, errors });
      totals.unratedLeads += counts.unratedLeads;
      totals.judged += counts.judged;
      totals.charged += counts.charged;
      totals.uncharged += counts.uncharged;
      totals.chargedUnknown += counts.chargedUnknown;
      for (const [k, v] of Object.entries(counts.notJudged)) {
        totals.notJudged[k] = (totals.notJudged[k] ?? 0) + v;
      }
      for (const [k, v] of Object.entries(counts.byAnswer)) {
        totals.byAnswer[k] = (totals.byAnswer[k] ?? 0) + v;
      }
    } catch (err) {
      perClient.push({
        client: c.name,
        customerId: c.googleAdsCustomerId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    dryRun: true,
    sentToGoogle: false,
    window: { fromDate, toDate },
    totals,
    // Every unrated lead is accounted for: judged + every not-judged reason
    // must equal unratedLeads, or something was silently dropped.
    accountingBalances:
      totals.judged + Object.values(totals.notJudged).reduce((a, b) => a + b, 0) ===
      totals.unratedLeads,
    perClient,
  });
}
