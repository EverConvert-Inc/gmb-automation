import { NextResponse } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { lsaClients, lsaLeadRatingDryRuns } from "@/lib/db/schema";
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
  // Read back what a previous run recorded, without running anything. The
  // dry run is only useful if its verdicts can actually be reviewed.
  const resultsOnly = url.searchParams.get("results") === "true";
  const all = url.searchParams.get("all") === "true";
  // Re-classify leads the intake team already rated, for comparison only.
  const population = url.searchParams.get("rated") === "true" ? "rated" : "unrated";

  if (resultsOnly) {
    const rows = await db
      .select()
      .from(lsaLeadRatingDryRuns)
      .innerJoin(lsaClients, eq(lsaClients.id, lsaLeadRatingDryRuns.lsaClientId))
      .where(
        and(
          customerId ? eq(lsaClients.googleAdsCustomerId, customerId) : undefined,
          eq(
            lsaLeadRatingDryRuns.alreadyRated,
            url.searchParams.get("rated") === "true",
          ),
        ),
      );
    return NextResponse.json({
      dryRun: true,
      sentToGoogle: false,
      population: url.searchParams.get("rated") === "true" ? "rated" : "unrated",
      rowCount: rows.length,
      rows: rows.map((r) => ({
        client: r.lsa_clients.name,
        ...r.lsa_lead_rating_dry_runs,
      })),
    });
  }
  const days = Number(url.searchParams.get("days") ?? "30");
  const limit = Number(url.searchParams.get("limit") ?? "50");
  if (!customerId && !all) {
    return NextResponse.json(
      { error: "?customerId= or ?all=true is required" },
      { status: 400 },
    );
  }

  // Honour explicit from/to. These were previously accepted silently and
  // then ignored, so a request asking for one window was answered for
  // another — the kind of mismatch that is invisible in the output.
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  for (const [k, v] of [["from", fromParam], ["to", toParam]] as const) {
    if (v !== null && !DATE_RE.test(v)) {
      return NextResponse.json(
        { error: `${k} must be YYYY-MM-DD` },
        { status: 400 },
      );
    }
  }
  if ((fromParam === null) !== (toParam === null)) {
    return NextResponse.json(
      { error: "from and to must be given together, or neither (use days)" },
      { status: 400 },
    );
  }
  if (fromParam && toParam && fromParam > toParam) {
    return NextResponse.json({ error: "from must not be after to" }, { status: 400 });
  }
  const toDate = toParam ?? new Date().toISOString().slice(0, 10);
  const fromDate =
    fromParam ?? new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

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
      const { counts, errors } = await runLeadRatingDryRun(c.id, {
        fromDate,
        toDate,
        limit,
        population,
      });
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
    population,
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
