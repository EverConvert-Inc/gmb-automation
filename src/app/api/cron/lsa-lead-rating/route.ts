import { NextResponse } from "next/server";
import { runLeadRatingDryRun, emptyCounts, type DryRunCounts } from "@/lib/lsa-lead-rating";
import { daysAgoIsoEastern, todayIsoEastern } from "@/lib/date-utils";
import {
  clientsDueForScan,
  markScanned,
  submitLeadRating,
  submissionEnabled,
  dailyCapPerClient,
  pendingResubmissions,
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

  // Eastern, not UTC: Google applies these bounds in the account's own
  // timezone. Built from UTC, every run between 00:00-04:00 ET used a
  // fromDate a day late and could skip leads near the boundary — and this
  // runs every 10 minutes, so it hit that window nightly.
  const toDate = todayIsoEastern();
  const fromDate = daysAgoIsoEastern(days);

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
      // Google's rejection text, reported inline. Reading a submission —
      // sent or rejected — must never require a database query.
      const submitFailures: Array<Record<string, unknown>> = [];
      const sentLeads: Array<Record<string, unknown>> = [];
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
        if (r.sent) {
          sentLeads.push({
            leadId: jl.leadId,
            answer: jl.answer,
            dissatisfiedReason: jl.dissatisfiedReason,
          });
        }
        if (!r.sent && r.detail) {
          submitFailures.push({
            leadId: jl.leadId,
            answer: jl.answer,
            dissatisfiedReason: jl.dissatisfiedReason,
            reason: r.reason,
            error: r.detail,
          });
        }
      }

      // Leads judged on an earlier run whose submission never landed. The
      // rating pass reports these as skippedExisting and never re-offers
      // them, so retrying has to be driven off the stored verdict.
      const handledThisRun = new Set(judgedLeads.map((j) => j.leadId));
      const retries = (await pendingResubmissions(c, limit)).filter(
        (r) => !handledThisRun.has(r.leadId),
      );
      const resubmitted: Record<string, number> = {};
      for (const r of retries) {
        const out = await submitLeadRating({
          client: c,
          leadId: r.leadId,
          leadResourceName: r.leadResourceName,
          surveyAnswer: r.answer,
          dissatisfiedReason: r.dissatisfiedReason,
        });
        const key = out.sent ? "sent" : out.reason;
        resubmitted[key] = (resubmitted[key] ?? 0) + 1;
        submitTally[`retry_${key}`] = (submitTally[`retry_${key}`] ?? 0) + 1;
        if (out.sent) {
          sentLeads.push({
            leadId: r.leadId,
            answer: r.answer,
            dissatisfiedReason: r.dissatisfiedReason,
            retry: true,
          });
        }
        if (!out.sent && out.detail) {
          submitFailures.push({
            leadId: r.leadId,
            answer: r.answer,
            dissatisfiedReason: r.dissatisfiedReason,
            reason: out.reason,
            retry: true,
            error: out.detail,
          });
        }
      }

      perClient.push({
        client: c.name,
        allowlisted: c.leadRatingEnabled,
        counts,
        submitted,
        resubmitted,
        sentLeads,
        submitFailures,
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
