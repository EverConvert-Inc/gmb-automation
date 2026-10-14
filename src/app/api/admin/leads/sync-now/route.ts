import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { createSyncDeps } from "@/lib/leads/deps";
import { syncLeadsForMonth } from "@/lib/leads/sync";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * The first route-level authorization check in this codebase. Every other
 * internal route relies solely on the middleware's "is there a session"
 * gate, which cannot tell a staff member from a client user — so this route
 * checks the staff tag itself rather than inheriting a gate that does not
 * yet exist.
 *
 * app_metadata, never user_metadata: user_metadata is writable by the user
 * through supabase.auth.updateUser(), so a client could grant themselves
 * whatever it held. app_metadata is writable only by the service role or by
 * direct SQL.
 *
 * NOTE this 403s for everyone until the staff accounts are tagged. That is
 * the intended order — tag first, then deploy — and nothing calls this route
 * yet. Use the cron route with the CRON_SECRET bearer for the preview dry
 * run instead.
 */
async function requireAdmin(): Promise<
  { ok: true } | { ok: false; status: number; error: string }
> {
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return { ok: false, status: 401, error: "not signed in" };
  const role = (user.app_metadata as Record<string, unknown> | null | undefined)
    ?.role;
  if (role !== "admin") return { ok: false, status: 403, error: "admin only" };
  return { ok: true };
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const url = new URL(req.url);
  const dryRun =
    url.searchParams.get("dryRun") === "1" ||
    url.searchParams.get("dry_run") === "1";

  const companyParam = url.searchParams.get("companyIds");
  const companyIds = companyParam
    ? companyParam.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  const result = await syncLeadsForMonth(createSyncDeps(), {
    triggeredBy: dryRun ? "dry-run" : "manual",
    dryRun,
    companyIds,
  });

  const allFailed = result.calls.error !== null && result.forms.error !== null;
  return NextResponse.json(result, { status: allFailed ? 500 : 200 });
}
