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

// Temporary read-only diagnostic. Scoping question: which metric should
// back an "under 80%" alert — campaign.optimization_score /
// metrics.optimization_score_url, or a Local Services "responsiveness"
// field? A field-list inspection of the installed google-ads-api@23.0.0
// package (build/src/protos/autogen/fields.d.ts) found no field containing
// "respons*" anywhere under local_services_lead, local_services_lead_
// conversation, local_services_employee, or local_services_verification_
// artifact (or anywhere else in the whole field list) — so there is no
// second query to run here; this route only exercises the
// optimization-score fields against the campaign resource. No DB writes.
// Delete once the alert's data source is decided.
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
      SELECT campaign.id, campaign.advertising_channel_type,
             campaign.optimization_score, metrics.optimization_score_url
      FROM campaign
      WHERE campaign.advertising_channel_type = 'LOCAL_SERVICES'
    `);

    return NextResponse.json({
      customerId: TEST_CUSTOMER_ID,
      count: rows.length,
      rows,
      responsivenessFieldFound: false,
      responsivenessCheckNote:
        "No field containing 'respons*' exists anywhere in google-ads-api@23.0.0's field list under any local_services_* resource (or elsewhere) — confirmed via a direct grep of the installed package, not guessed.",
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
      { customerId: TEST_CUSTOMER_ID, error: message, errors, inspected },
      { status: 500 },
    );
  }
}
