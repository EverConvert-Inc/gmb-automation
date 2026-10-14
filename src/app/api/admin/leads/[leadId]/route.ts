import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { leads } from "@/lib/db/schema";
import { requireAdminRoute } from "@/lib/leads/admin-auth";
import {
  LeadOverridePatch,
  buildOverrideUpdate,
} from "@/lib/leads/lead-overrides";

export const runtime = "nodejs";

/**
 * Admin edits to one lead. Writes *_override columns and nothing else — the
 * patch schema cannot name a *_parsed column, so the sync's view of what
 * CallRail said is unreachable from here, and the sync in turn cannot touch
 * an override because PlannedLead has no field for one. The two directions
 * are both structural rather than remembered.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const denied = await requireAdminRoute();
  if (denied) return denied;

  const { leadId } = await params;
  let parsed;
  try {
    parsed = LeadOverridePatch.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  const lead = await db.query.leads.findFirst({ where: eq(leads.id, leadId) });
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });

  const built = buildOverrideUpdate(
    parsed,
    { suggestedStatus: lead.suggestedStatus, statusOverride: lead.statusOverride },
    new Date(),
  );
  if (!built.ok) {
    return NextResponse.json({ error: built.error }, { status: 400 });
  }

  const [row] = await db
    .update(leads)
    .set(built.update)
    .where(eq(leads.id, leadId))
    .returning();
  return NextResponse.json(row);
}
