import { NextResponse } from "next/server";
import { runLeadRatingDryRun, emptyCounts, type DryRunCounts } from "@/lib/lsa-lead-rating";
import {
  clientsDueForScan,
  markScanned,
  submitLeadRating,
  submissionEnabled,
  dailyCapPerClient,
} from "@/lib/lsa-lead-submit";

export const runtime = "nodejs";
export const maxDuration = 300;

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

// How many clients one invocation handles. Small enough that a run stays
// well inside the 300s function limit (an ?all=true sweep over every client
// previously timed out), and the round-robin cursor means every client is
// still covered within a few cycles.
const BATCH_SIZE = Number(process.env.LSA_LEAD_RATING_BATCH ?? "6");

// Near-real-time LSA lead rating.
//
// Each run takes the least-recently-scanned clients, classifies their
// unrated leads, and — only when the kill switch and the per-client
// allowlist both permit it — submits those verdicts to Google.
//
// With LSA_LEAD_RATING_SUBMIT unset or not exactly "true", this is a pure
// dry run: verdicts are recorded and NOTHING reaches Google.
//
// Usage: GET /api/cron/lsa-lead-rating[?days=2][&limit=25][&batch=6]
export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 400 });
  }

  const url = new URL(req.url);
  // Default window is deliberately short: this runs every few minutes and
  // only needs leads that arrived recently. Older leads were settled by
  // earlier runs and are skipped by the existing-row check anyway.
  const days = Number(url.searchParams.get("days") ?? "2");
  const limit = Number(url.searchParams.get("limit") ?? "25");
  const batch = Number(url.searchParams.get("batch") ?? String(BATCH_SIZE));

  const toDate = new Date().toISOString().slice(0, 10);
  const fromDate = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const clients = await clientsDueForScan(batch);
  const totals: DryRunCounts = emptyCounts();
  const submitTally: Record<string, number> = {};
  const perClient: Array<Record<string, unknown>> = [];

  for (const c of clients) {
    try {
      const { counts, errors, judgedLeads } = await runLeadRatingDryRun(c.id, {
        fromDate,
        toDate,
        limit,
      });

      const submitted: Record<string, number> = {};
      for (const jl of judgedLeads) {
        const r = await submitLeadRating({
          client: c,
          leadId: jl.leadId,
          leadResourceName: jl.leadResourceName,
          surveyAnswer: jl.answer,
          dissatisfiedReason: jl.dissatisfiedReason,
        });
        const key = r.sent ? "sent" : r.reason;
        submitted[key] = (submitted[key] ?? 0) + 1;
        submitTally[key] = (submitTally[key] ?? 0) + 1;
      }

      perClient.push({
        client: c.name,
        allowlisted: c.leadRatingEnabled,
        counts,
        submitted,
        errors,
      });
      totals.unratedLeads += counts.unratedLeads;
      totals.judged += counts.judged;
      totals.skippedExisting += counts.skippedExisting;
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
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      // Advance the cursor even on failure, so one broken client cannot
      // block every other client from ever being scanned.
      await markScanned(c.id);
    }
  }

  return NextResponse.json({
    submissionEnabled: submissionEnabled(),
    dryRun: !submissionEnabled(),
    dailyCapPerClient: dailyCapPerClient(),
    window: { fromDate, toDate },
    clientsScanned: clients.map((c) => c.name),
    totals,
    submissions: submitTally,
    perClient,
  });
}
