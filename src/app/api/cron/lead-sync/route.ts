import { NextResponse } from "next/server";
import { createSyncDeps } from "@/lib/leads/deps";
import { syncLeadsForMonth } from "@/lib/leads/sync";

export const runtime = "nodejs";
export const maxDuration = 300;

// NOT registered in vercel.json yet, and must not be until a dry run has
// confirmed every CallRail field name on preview — CallRail 400s an entire
// request on one unknown field, so the first scheduled run would otherwise
// fail silently into a job row nobody reads.
//
// Until then this follows the repo's diagnostic-route convention: reachable
// only with the CRON_SECRET bearer, exempt from the session gate via the
// /api/cron prefix (see supabase/middleware.ts), safe to curl by hand.
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

  const result = await syncLeadsForMonth(createSyncDeps(), {
    triggeredBy: dryRun ? "dry-run" : "scheduled",
    dryRun,
    companyIds,
  });

  // 500 only when NOTHING worked. A single source failing still leaves real
  // rows written by the other, and its own job row carries the error — so
  // failing the whole response would misreport a partial success.
  const allFailed = result.calls.error !== null && result.forms.error !== null;
  return NextResponse.json(result, { status: allFailed ? 500 : 200 });
}
