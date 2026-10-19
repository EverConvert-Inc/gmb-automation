import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/leads/admin-auth";
import { createSyncDeps } from "@/lib/leads/deps";
import { syncLeadsForMonth } from "@/lib/leads/sync";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  // Shared with every other admin route rather than keeping its own copy —
  // two implementations of one auth check is how they drift apart.
  const denied = await requireAdminRoute();
  if (denied) return denied;

  const url = new URL(req.url);
  const dryRun =
    url.searchParams.get("dryRun") === "1" ||
    url.searchParams.get("dry_run") === "1";

  const companyParam = url.searchParams.get("companyIds");
  const companyIds = companyParam
    ? companyParam.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  // Texts only when asked for (?texts=1).
  const includeTexts = url.searchParams.get("texts") === "1";

  const result = await syncLeadsForMonth(createSyncDeps(), {
    triggeredBy: dryRun ? "dry-run" : "manual",
    dryRun,
    companyIds,
    includeTexts,
  });

  const allFailed =
    result.calls.error !== null && result.forms.error !== null && (result.texts === null || result.texts.error !== null);
  return NextResponse.json(result, { status: allFailed ? 500 : 200 });
}
