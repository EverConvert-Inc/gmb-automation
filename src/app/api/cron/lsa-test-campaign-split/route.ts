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
// Atlanta Accident Lawyers — NOT a migrated account (confirmed). The ads
// team manually added a regular PPC campaign into this LSA-derived Ads
// account, so its "Cost" total now blends LSA + PPC spend even though the
// old LSA dashboard only ever showed the LSA portion. Still a useful test
// case here: the account should have both an LSA-flagged campaign and the
// added PPC one in the same response.
const TEST_CUSTOMER_ID = "4874592531";
const TEST_LOGIN_CUSTOMER_ID = "6633117348";

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

// Temporary read-only diagnostic for per-campaign PPC/LSA cost splitting
// within a single Google Ads account. Originally written to check for
// Google's LSA-to-PMax account migration (Aug 2026 rollout), but that
// turned out not to be what's happening on any account here yet — what's
// actually needed sooner is detecting which campaigns within an account
// are LSA (campaign.pmax_campaign_settings.local_services_enabled = true)
// vs. regular PPC, so a client whose ads team drops a PPC campaign into an
// LSA-derived account doesn't get its LSA cost overstated. Same field,
// same query, different trigger. Pulls the raw `campaign` resource for
// every campaign on this customer, with no date/status/channel-type
// filter, to confirm the field comes back as expected before any sync
// logic gets built on top of it. Requires google-ads-api >= 25.1.0 (this
// field doesn't exist in the proto set bundled by 23.0.0/24.1.0). No DB
// writes. Delete once splitting logic is confirmed and built.
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
