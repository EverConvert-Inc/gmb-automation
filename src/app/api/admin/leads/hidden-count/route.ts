import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/leads/admin-auth";
import { listHiddenByName } from "@/app/admin/leads/hidden/_lib/hidden";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The count behind the admin Leads tab's badge. Staff-only. Fetched by the
 * tab bar after the page loads, so the admin layout stays free of queries.
 */
export async function GET() {
  const denied = await requireAdminRoute();
  if (denied) return denied;
  const rows = await listHiddenByName();
  return NextResponse.json({ hidden: rows.length }, { headers: { "Cache-Control": "no-store" } });
}
