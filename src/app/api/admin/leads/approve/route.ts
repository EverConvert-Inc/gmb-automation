import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { checkAdmin } from "@/lib/leads/admin-auth";
import { ApproveBody, buildApproveUpdate } from "@/lib/leads/client-approval";

export const runtime = "nodejs";

/** "Approve for client" for one lead (drawer) or several (queue bulk approve). */
export async function POST(req: Request) {
  // checkAdmin rather than requireAdminRoute: the approval records the email.
  const auth = await checkAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body;
  try {
    body = ApproveBody.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  const leadIds = [...new Set(body.leadIds)];
  const rows = await buildApproveUpdate(db, leadIds, auth.email);
  return NextResponse.json({ approved: rows.map((r) => r.id), requested: leadIds.length });
}
