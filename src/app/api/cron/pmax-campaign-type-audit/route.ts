import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { ppcClients, oauthCredentials } from "@/lib/db/schema";
import { and, eq, ilike, isNotNull } from "drizzle-orm";
import { decryptString } from "@/lib/crypto";
import { pullCallViewRows } from "@/lib/google-ads";

export const runtime = "nodejs";
export const maxDuration = 300;

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type CampaignSummary = {
  campaignId: string;
  campaignName: string;
  campaignAdvertisingChannelType: string;
  rowCount: number;
};

type ClientResult =
  | {
      clientName: string;
      customerId: string;
      totalCallViewRows: number;
      campaignsWithCallViewActivity: CampaignSummary[];
    }
  | { clientName: string; customerId: string; error: string };

// Temporary read-only diagnostic: does ANY active client's Google Ads
// account have a non-PMax campaign producing call_view rows? Today,
// createGmbAdMatcher (src/lib/callrail.ts) reclassifies ANY matched
// call_view row into "PMax" — a Search campaign with call extensions, or
// a Call-only ad campaign, would get mislabeled the same way if it ever
// cross-references a CallRail call. Prior confirmed-real cases (Schuerger
// & Shunnarah, Hodgins & Kiber) only ever showed PERFORMANCE_MAX
// campaigns, but that was never checked across the full client roster —
// this does, using campaign.advertising_channel_type (added to
// pullCallViewRows for this).
//
// Runs across every active ppc_clients row with Google Ads configured (or
// a single client via ?client=<name substring>, matching the other
// diagnostics' convenience). One client's API failure doesn't abort the
// batch — recorded as {clientName, customerId, error} and the loop moves
// on. No DB writes, no changes to production matching logic (imports the
// real pullCallViewRows, doesn't reimplement it). Delete once answered.
//
// Usage: /api/cron/pmax-campaign-type-audit[?client=<name substring>]
export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const clientNameFilter = url.searchParams.get("client");

  const clients = await db.query.ppcClients.findMany({
    where: and(
      eq(ppcClients.isActive, true),
      isNotNull(ppcClients.googleAdsCustomerId),
      isNotNull(ppcClients.googleAdsOauthTokenId),
      clientNameFilter ? ilike(ppcClients.name, `%${clientNameFilter}%`) : undefined,
    ),
  });

  const results: ClientResult[] = [];
  for (const client of clients) {
    // Guaranteed non-null by the isNotNull() filters above — narrowed here
    // only to satisfy TypeScript, not a runtime possibility this loop
    // needs to handle.
    const customerId = client.googleAdsCustomerId!;
    const oauthTokenId = client.googleAdsOauthTokenId!;
    try {
      const cred = await db.query.oauthCredentials.findFirst({
        where: eq(oauthCredentials.id, oauthTokenId),
      });
      if (!cred) {
        results.push({
          clientName: client.name,
          customerId,
          error: "oauth_credentials row not found",
        });
        continue;
      }
      const refreshToken = decryptString(cred.refreshTokenEncrypted);
      const callViewRows = await pullCallViewRows(refreshToken, customerId);

      const byCampaign = new Map<string, CampaignSummary>();
      for (const row of callViewRows) {
        const existing = byCampaign.get(row.campaignId);
        if (existing) {
          existing.rowCount += 1;
        } else {
          byCampaign.set(row.campaignId, {
            campaignId: row.campaignId,
            campaignName: row.campaignName,
            campaignAdvertisingChannelType: row.campaignAdvertisingChannelType,
            rowCount: 1,
          });
        }
      }

      results.push({
        clientName: client.name,
        customerId,
        totalCallViewRows: callViewRows.length,
        campaignsWithCallViewActivity: Array.from(byCampaign.values()).sort(
          (a, b) => b.rowCount - a.rowCount,
        ),
      });
    } catch (err) {
      results.push({ clientName: client.name, customerId, error: describeError(err) });
    }
  }

  // The direct answer to "does this ever happen" — every campaign found
  // producing call_view rows that ISN'T PERFORMANCE_MAX, across every
  // client checked. Empty means no evidence of the risk materializing in
  // any currently-active account (not proof it never could — only that it
  // hasn't shown up in what's actually configured today).
  const nonPmaxFindings = results.flatMap((r) =>
    "campaignsWithCallViewActivity" in r
      ? r.campaignsWithCallViewActivity
          .filter((c) => c.campaignAdvertisingChannelType !== "PERFORMANCE_MAX")
          .map((c) => ({ clientName: r.clientName, ...c }))
      : [],
  );

  return NextResponse.json({
    clientsChecked: results.length,
    nonPmaxFindings,
    results,
  });
}
