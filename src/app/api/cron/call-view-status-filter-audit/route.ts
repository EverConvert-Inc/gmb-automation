import { NextResponse } from "next/server";
import { enums } from "google-ads-api";
import { db } from "@/lib/db/client";
import { ppcClients, oauthCredentials } from "@/lib/db/schema";
import { and, eq, ilike, isNotNull } from "drizzle-orm";
import { decryptString } from "@/lib/crypto";
import { getCustomer } from "@/lib/google-ads";

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

function decodeCampaignStatus(raw: unknown): string {
  if (typeof raw !== "number") return String(raw ?? "");
  return (enums.CampaignStatus as Record<number, string>)[raw] ?? String(raw);
}

type RawCallViewRow = {
  startCallDateTime: string;
  callDurationSeconds: number;
  callerAreaCode: string;
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
};

async function queryCallView(
  refreshToken: string,
  customerId: string,
  filterEnabled: boolean,
): Promise<RawCallViewRow[]> {
  const customer = getCustomer(refreshToken, customerId);
  const rows = await customer.query(`
    SELECT
      call_view.start_call_date_time,
      call_view.call_duration_seconds,
      call_view.caller_area_code,
      campaign.id,
      campaign.name,
      campaign.status
    FROM call_view
    ${filterEnabled ? "WHERE campaign.status = 'ENABLED'" : ""}
    ORDER BY call_view.start_call_date_time DESC
    LIMIT 1000
  `);
  return rows.map((r) => {
    const callView = (r as { call_view?: Record<string, unknown> }).call_view ?? {};
    const campaign = r.campaign ?? {};
    return {
      startCallDateTime: String(callView.start_call_date_time ?? ""),
      callDurationSeconds: Number(callView.call_duration_seconds ?? 0),
      callerAreaCode: String(callView.caller_area_code ?? ""),
      campaignId: String(campaign.id ?? ""),
      campaignName: String(campaign.name ?? ""),
      campaignStatus: decodeCampaignStatus(campaign.status),
    };
  });
}

function rowKey(r: RawCallViewRow): string {
  return `${r.startCallDateTime}|${r.callDurationSeconds}|${r.campaignId}`;
}

// Temporary read-only diagnostic. Directly tests whether pullCallViewRows'
// `WHERE campaign.status = 'ENABLED'` filter (google-ads.ts) is silently
// dropping real call_view rows tied to campaigns that have since been
// paused/removed — the same bug class already found and fixed in
// pullDailyMetrics and pullLocalServicesCost, but never live-confirmed for
// call_view specifically (call_view has already been seen to reject a field
// — segments.date — that works fine on `campaign` directly, so this
// filter's behavior isn't assumed to carry over).
//
// Runs the exact same query twice per client — once with the production
// filter, once without — and diffs the two row sets. Any row present in the
// unfiltered set but missing from the filtered set is a row production is
// currently, silently losing from PMax call-attribution matching.
//
// Runs across every active ppc_clients row with Google Ads configured (or a
// single client via ?client=<name substring>). One client's API failure
// doesn't abort the batch. No DB writes, no changes to production matching
// logic. Delete once the filter question is answered either way.
//
// Usage: /api/cron/call-view-status-filter-audit[?client=<name substring>]
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

  type ClientResult =
    | {
        clientName: string;
        customerId: string;
        filteredRowCount: number;
        unfilteredRowCount: number;
        droppedRowCount: number;
        droppedRows: RawCallViewRow[];
      }
    | { clientName: string; customerId: string; error: string };

  const results: ClientResult[] = [];
  for (const client of clients) {
    const customerId = client.googleAdsCustomerId!;
    const oauthTokenId = client.googleAdsOauthTokenId!;
    try {
      const cred = await db.query.oauthCredentials.findFirst({
        where: eq(oauthCredentials.id, oauthTokenId),
      });
      if (!cred) {
        results.push({ clientName: client.name, customerId, error: "oauth_credentials row not found" });
        continue;
      }
      const refreshToken = decryptString(cred.refreshTokenEncrypted);

      const [filtered, unfiltered] = await Promise.all([
        queryCallView(refreshToken, customerId, true),
        queryCallView(refreshToken, customerId, false),
      ]);

      const filteredKeys = new Set(filtered.map(rowKey));
      const droppedRows = unfiltered.filter((r) => !filteredKeys.has(rowKey(r)));

      results.push({
        clientName: client.name,
        customerId,
        filteredRowCount: filtered.length,
        unfilteredRowCount: unfiltered.length,
        droppedRowCount: droppedRows.length,
        droppedRows,
      });
    } catch (err) {
      results.push({ clientName: client.name, customerId, error: describeError(err) });
    }
  }

  const totalDropped = results.reduce(
    (sum, r) => sum + ("droppedRowCount" in r ? r.droppedRowCount : 0),
    0,
  );

  return NextResponse.json({
    clientsChecked: results.length,
    // The direct answer: >0 means the ENABLED filter is provably dropping
    // real call_view rows today, for a currently-configured client. 0 means
    // no evidence of it materializing right now (not proof it never could).
    totalDroppedRowsAcrossAllClients: totalDropped,
    results,
  });
}
