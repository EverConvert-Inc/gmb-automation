import { NextResponse } from "next/server";
import { inspect } from "node:util";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { oauthCredentials } from "@/lib/db/schema";
import { decryptString } from "@/lib/crypto";
import { getCustomer } from "@/lib/google-ads";

export const runtime = "nodejs";
export const maxDuration = 300;

const TEST_ACCOUNT_EMAIL = "accounts@everconvert.com";
// Atlanta Accident Lawyers — confirmed by the team as an account that has
// already migrated from standalone LSA into a PMax campaign.
const TEST_CUSTOMER_ID = "4874592531";
const TEST_LOGIN_CUSTOMER_ID = "6633117348";

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

// Temporary read-only diagnostic for the LSA-to-PMax migration (Google's
// Aug 2026 rollout — migrated accounts report LSA data through the regular
// Google Ads API as a PMax campaign instead of the standalone Local
// Services API). Pulls the raw `campaign` resource for every campaign on
// this customer, with no date/status filter, to confirm
// campaign.pmax_campaign_settings.local_services_enabled actually comes
// back as expected on a known-migrated account before any sync logic gets
// built around it. Requires google-ads-api >= 25.1.0 (this field doesn't
// exist in the proto set bundled by 23.0.0/24.1.0). No DB writes. Delete
// once migration detection has been confirmed live.
export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const customerId = url.searchParams.get("customerId") ?? TEST_CUSTOMER_ID;
  const loginCustomerId =
    url.searchParams.get("loginCustomerId") ?? TEST_LOGIN_CUSTOMER_ID;

  try {
    const cred = await db.query.oauthCredentials.findFirst({
      where: and(
        eq(oauthCredentials.provider, "google_ads"),
        eq(oauthCredentials.accountEmail, TEST_ACCOUNT_EMAIL),
      ),
    });
    if (!cred) {
      return NextResponse.json(
        {
          error: `No google_ads oauth_credentials row found for ${TEST_ACCOUNT_EMAIL}`,
        },
        { status: 404 },
      );
    }

    const refreshToken = decryptString(cred.refreshTokenEncrypted);
    const customer = getCustomer(refreshToken, customerId, loginCustomerId);

    const rows = await customer.query(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign.advertising_channel_sub_type,
        campaign.local_services_campaign_settings.category_bids,
        campaign.pmax_campaign_settings.local_services_enabled,
        campaign.pmax_campaign_settings.local_services_pmax_campaign_settings.country_code,
        campaign.pmax_campaign_settings.local_services_pmax_campaign_settings.founding_year,
        campaign.pmax_campaign_settings.local_services_pmax_campaign_settings.navigational_query_leads_enabled,
        campaign.pmax_campaign_settings.local_services_pmax_campaign_settings.phone_numbers
      FROM campaign
    `);

    return NextResponse.json({ customerId, loginCustomerId, count: rows.length, rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Same error-unpacking as the other lsa-test* diagnostics — the
    // library's GoogleAdsFailure carries the real detail in `.errors[]`,
    // often behind getters JSON.stringify silently drops.
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
      { customerId, loginCustomerId, error: message, errors, inspected },
      { status: 500 },
    );
  }
}
