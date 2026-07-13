import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { lsaClients } from "@/lib/db/schema";
import { daysAgoIso, syncLsaForClient, yesterdayIso } from "@/lib/lsa-sync";

export const runtime = "nodejs";
// Trailing-30-day full sync can take a while when there's a lot of lead
// history. Give it room.
export const maxDuration = 300;

// POST /api/lsa/clients/[id]/sync-now
// Pulls trailing 30 days for both Google Ads and CallRail (whichever is
// linked). Unlike PPC's sync-now (which calls two separate sync functions
// and hand-rolls the try/catch per source), syncLsaForClient() already
// handles both sources internally with independent try/catch and
// partial-failure reporting, so this route just forwards its result.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const client = await db.query.lsaClients.findFirst({
    where: eq(lsaClients.id, id),
  });
  if (!client) return NextResponse.json({ error: "not found" }, { status: 404 });

  const fromDate = daysAgoIso(30);
  const toDate = yesterdayIso();

  try {
    const result = await syncLsaForClient(id, {
      fromDate,
      toDate,
      triggeredBy: "manual",
    });
    return NextResponse.json({ fromDate, toDate, ...result });
  } catch (err) {
    const message = (err as Error).message;
    return NextResponse.json({ fromDate, toDate, error: message }, { status: 500 });
  }
}
