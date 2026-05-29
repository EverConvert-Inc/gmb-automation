import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ppcClients } from "@/lib/db/schema";
import {
  daysAgoIso,
  syncCallrailForClient,
  syncGoogleAdsForClient,
  yesterdayIso,
} from "@/lib/ppc-sync";

export const runtime = "nodejs";
// Trailing-30-day full sync per integration can take a while when there are
// many campaigns. Give it room.
export const maxDuration = 300;

// POST /api/ppc/clients/[id]/sync-now
// Pulls trailing 30 days of data for both Google Ads and CallRail (whichever
// is linked). Best-effort per integration; if one errors the other still
// runs and we report the partial outcome.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const client = await db.query.ppcClients.findFirst({
    where: eq(ppcClients.id, id),
  });
  if (!client) return NextResponse.json({ error: "not found" }, { status: 404 });

  const fromDate = daysAgoIso(30);
  const toDate = yesterdayIso();
  const result: {
    googleAds: { ok: boolean; error?: string; daysIngested?: number };
    callrail: { ok: boolean; error?: string; daysIngested?: number };
  } = {
    googleAds: { ok: false },
    callrail: { ok: false },
  };

  if (client.googleAdsOauthTokenId && client.googleAdsCustomerId) {
    try {
      const r = await syncGoogleAdsForClient(id, {
        fromDate,
        toDate,
        triggeredBy: "manual",
      });
      result.googleAds = { ok: true, daysIngested: r.daysIngested };
    } catch (err) {
      result.googleAds = { ok: false, error: (err as Error).message };
    }
  } else {
    result.googleAds = { ok: false, error: "Not linked" };
  }

  if (client.callrailCompanyId) {
    try {
      const r = await syncCallrailForClient(id, {
        fromDate,
        toDate,
        triggeredBy: "manual",
      });
      result.callrail = { ok: true, daysIngested: r.daysIngested };
    } catch (err) {
      result.callrail = { ok: false, error: (err as Error).message };
    }
  } else {
    result.callrail = { ok: false, error: "Not linked" };
  }

  return NextResponse.json(result);
}
