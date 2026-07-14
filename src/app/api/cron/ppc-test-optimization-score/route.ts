import { NextResponse } from "next/server";
import { inspect } from "node:util";
import { and, eq, ilike } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { oauthCredentials, ppcClients } from "@/lib/db/schema";
import { decryptString } from "@/lib/crypto";
import { getCustomer } from "@/lib/google-ads";

export const runtime = "nodejs";
export const maxDuration = 300;

// Any active, real-spend PPC client works here — picks the first match by
// name rather than a hardcoded customer id so this doesn't need updating
// if the account changes.
const TEST_CLIENT_NAME_FILTER = "weinstein";

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

// Temporary read-only diagnostic. Counterpart to the now-deleted
// lsa-test-optimization-score: that route confirmed optimization_score is
// absent/inapplicable for LOCAL_SERVICES campaigns. This one checks the
// same fields against a real PPC (non-LOCAL_SERVICES) customer, using
// PPC's existing client lookup + MCC login_customer_id setup (getCustomer
// falls back to GOOGLE_ADS_LOGIN_CUSTOMER_ID when no override is passed —
// same as pullDailyMetrics) rather than LSA's dedicated MCC. No DB writes.
// Delete once the alert's data source is decided.
export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const client = await db.query.ppcClients.findFirst({
      where: and(
        eq(ppcClients.isActive, true),
        ilike(ppcClients.name, `%${TEST_CLIENT_NAME_FILTER}%`),
      ),
    });
    if (!client) {
      return NextResponse.json(
        {
          error: `No active ppc_clients row found matching name filter "${TEST_CLIENT_NAME_FILTER}"`,
        },
        { status: 404 },
      );
    }
    if (!client.googleAdsOauthTokenId || !client.googleAdsCustomerId) {
      return NextResponse.json(
        {
          error: `PPC client "${client.name}" is missing googleAdsOauthTokenId or googleAdsCustomerId`,
        },
        { status: 404 },
      );
    }

    const cred = await db.query.oauthCredentials.findFirst({
      where: eq(oauthCredentials.id, client.googleAdsOauthTokenId),
    });
    if (!cred) {
      return NextResponse.json(
        {
          error: `No oauth_credentials row found for id ${client.googleAdsOauthTokenId}`,
        },
        { status: 404 },
      );
    }

    const refreshToken = decryptString(cred.refreshTokenEncrypted);
    const customer = getCustomer(refreshToken, client.googleAdsCustomerId);

    const rows = await customer.query(`
      SELECT campaign.id, campaign.name, campaign.optimization_score, metrics.optimization_score_url
      FROM campaign
      WHERE campaign.advertising_channel_type != 'LOCAL_SERVICES'
    `);

    return NextResponse.json({
      clientName: client.name,
      customerId: client.googleAdsCustomerId,
      count: rows.length,
      rows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Same extraction as lsa-test/lsa-test-cost — google-ads-api throws a
    // GoogleAdsFailure whose `.errors[]` entries carry the real detail
    // often via getters, which JSON.stringify silently drops.
    const rawErrors = (err as { errors?: unknown[] })?.errors;
    const errors = Array.isArray(rawErrors)
      ? rawErrors.map((item) => {
          const e = (item ?? {}) as Record<string, unknown>;
          return {
            error_code: e.error_code ?? e.errorCode ?? null,
            message: e.message ?? null,
            trigger: e.trigger ?? null,
            location: e.location ?? null,
            details: e.details ?? null,
          };
        })
      : null;

    const inspected = inspect(err, {
      depth: null,
      getters: true,
      showHidden: true,
    });

    return NextResponse.json(
      { error: message, errors, inspected },
      { status: 500 },
    );
  }
}
