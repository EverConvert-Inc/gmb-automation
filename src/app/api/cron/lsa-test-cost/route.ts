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
const TEST_CUSTOMER_ID = "7596762098";
const TEST_LOGIN_CUSTOMER_ID = "6633117348";

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

// Temporary read-only diagnostic for LSA scoping. Confirms whether the
// existing accounts@everconvert.com Google Ads OAuth credentials can pull
// LOCAL_SERVICES campaign cost via the standard `campaign`/`metrics`
// resources (as opposed to the local_services_lead resource lsa-test
// checks), and shows exactly what comes back (data or the API error). No
// DB writes. Delete once LSA access has been confirmed.
export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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
    const customer = getCustomer(refreshToken, TEST_CUSTOMER_ID, TEST_LOGIN_CUSTOMER_ID);

    const rows = await customer.query(`
      SELECT campaign.id, campaign.advertising_channel_type, metrics.cost_micros
      FROM campaign
      WHERE campaign.advertising_channel_type = 'LOCAL_SERVICES'
        AND segments.date DURING LAST_30_DAYS
    `);

    return NextResponse.json({
      customerId: TEST_CUSTOMER_ID,
      count: rows.length,
      rows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // google-ads-api throws a GoogleAdsFailure whose `.errors[]` entries
    // carry the real detail (error_code, message, trigger, location) —
    // often via getters, which JSON.stringify silently drops. Pull known
    // fields by direct property access (which invokes getters normally)
    // instead of trying to serialize the object generically.
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

    // Full dump as a fallback in case the shape above is wrong or
    // incomplete — `getters: true` forces util.inspect to evaluate getter
    // properties instead of just printing "[Getter]".
    const inspected = inspect(err, {
      depth: null,
      getters: true,
      showHidden: true,
    });

    return NextResponse.json(
      { customerId: TEST_CUSTOMER_ID, error: message, errors, inspected },
      { status: 500 },
    );
  }
}
