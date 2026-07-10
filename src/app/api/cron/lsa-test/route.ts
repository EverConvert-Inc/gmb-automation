import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { oauthCredentials } from "@/lib/db/schema";
import { decryptString } from "@/lib/crypto";
import { getCustomer } from "@/lib/google-ads";

export const runtime = "nodejs";
export const maxDuration = 300;

const TEST_ACCOUNT_EMAIL = "accounts@everconvert.com";
const TEST_CUSTOMER_ID = "6633117348";

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

// Temporary read-only diagnostic for LSA scoping. Confirms whether the
// existing accounts@everconvert.com Google Ads OAuth credentials can query
// local_services_lead for the LSA MCC (663-311-7348), and shows exactly
// what comes back (data or the API error). No DB writes. Delete once LSA
// access has been confirmed.
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
    const customer = getCustomer(refreshToken, TEST_CUSTOMER_ID);

    const rows = await customer.query(`
      SELECT local_services_lead.id, local_services_lead.lead_type,
             local_services_lead.lead_status, local_services_lead.creation_date_time
      FROM local_services_lead
      WHERE local_services_lead.creation_date_time DURING LAST_30_DAYS
    `);

    return NextResponse.json({
      customerId: TEST_CUSTOMER_ID,
      count: rows.length,
      rows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    let raw: unknown;
    try {
      raw = JSON.parse(JSON.stringify(err, Object.getOwnPropertyNames(err as object)));
    } catch {
      raw = undefined;
    }
    return NextResponse.json(
      { customerId: TEST_CUSTOMER_ID, error: message, raw },
      { status: 500 },
    );
  }
}
