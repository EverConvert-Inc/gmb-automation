import { NextResponse } from "next/server";
import { getReconciliationForClient } from "@/lib/queries-google-ads-reconciliation";
import { stringifyError } from "@/lib/leads/sync";

export const runtime = "nodejs";
export const maxDuration = 60;

// Reconciliation rows for one account over [from, to], fetched when an account
// row on /ads/reconciliation is expanded. Behind the normal Supabase gate.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId") ?? "";
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!clientId || !from || !to) {
    return NextResponse.json({ error: "clientId, from and to are required" }, { status: 400 });
  }
  try {
    const result = await getReconciliationForClient(clientId, from, to);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
    return NextResponse.json({
      rows: result.rows,
      summary: result.summary,
      formError: result.formError,
    });
  } catch (err) {
    return NextResponse.json({ error: stringifyError(err) }, { status: 500 });
  }
}
