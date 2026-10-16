import { NextResponse } from "next/server";
import { createSyncDeps } from "@/lib/leads/deps";
import { syncLeadsForMonth, type SyncScope } from "@/lib/leads/sync";

export const runtime = "nodejs";
export const maxDuration = 300;

// Scheduled in vercel.json as "/api/cron/lead-sync?scope=mapped" at 30 8 * * *
// (08:30 UTC = 04:30 Eastern in summer, 03:30 in winter — after Eastern
// midnight either way, and clear of the CallRail crons at 11:10/11:20 UTC).
//
// The daily run fetches only the CallRail companies mapped to an active firm
// (scope=mapped); a firm tag still beats the company for every lead it
// fetches. It starts by failing job rows left "running" by a killed run,
// stops starting new company fetches after a 220s budget (writing what it
// has and finishing the job as failed with "stopped after N of M
// companies"), and reaches its new-lead window back to the last completed
// run so the final hours of a month are not missed. See src/lib/leads/sync.ts.
//
// Requires the CRON_SECRET bearer, which Vercel's cron sends; exempt from the
// session gate via the /api/cron prefix (see supabase/middleware.ts). A manual
// call without scope covers the whole account (scope=all); ?dryRun=1 writes
// nothing; ?companyIds=A,B narrows a manual run.
function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun =
    url.searchParams.get("dryRun") === "1" ||
    url.searchParams.get("dry_run") === "1";

  // Narrows the fetch to specific CallRail companies, for a first dry run
  // that should not pull the whole account.
  const companyParam = url.searchParams.get("companyIds");
  const companyIds = companyParam
    ? companyParam.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  // scope=mapped fetches only companies mapped to an active firm (the daily
  // cron); without it a run covers the whole account, as before.
  const scopeParam = url.searchParams.get("scope");
  if (scopeParam !== null && scopeParam !== "mapped" && scopeParam !== "all") {
    return NextResponse.json({ error: "scope must be mapped or all" }, { status: 400 });
  }
  if (scopeParam !== null && companyIds) {
    return NextResponse.json({ error: "use either scope or companyIds, not both" }, { status: 400 });
  }
  const scope: SyncScope = scopeParam === "mapped" ? "mapped" : "all";

  const result = await syncLeadsForMonth(createSyncDeps(), {
    triggeredBy: dryRun ? "dry-run" : "scheduled",
    dryRun,
    scope,
    companyIds,
  });

  // 500 only when NOTHING worked. A single source failing still leaves real
  // rows written by the other, and its own job row carries the error — so
  // failing the whole response would misreport a partial success.
  const allFailed = result.calls.error !== null && result.forms.error !== null;
  return NextResponse.json(result, { status: allFailed ? 500 : 200 });
}
