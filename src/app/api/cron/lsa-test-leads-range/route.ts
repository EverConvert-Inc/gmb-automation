import { NextResponse } from "next/server";
import { inspect } from "node:util";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { oauthCredentials } from "@/lib/db/schema";
import { decryptString } from "@/lib/crypto";
import { pullLocalServicesLeads } from "@/lib/google-ads";
import { daysAgoIsoEastern, todayIsoEastern } from "@/lib/date-utils";

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

// Temporary diagnostic: pullLocalServicesLeads()'s arbitrary-range path
// (creation_date_time BETWEEN '<from> 00:00:00' AND '<to> 23:59:59')
// typechecks but has never been run live — lsa-test only ever exercised
// DURING LAST_30_DAYS. This confirms the BETWEEN form actually returns
// rows over an explicit 7-day window before lsa-sync.ts is built on top
// of it. No DB writes. Delete once confirmed.
export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const toDate = todayIsoEastern();
  const fromDate = daysAgoIsoEastern(6); // 7-day window, inclusive of today

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
    const rows = await pullLocalServicesLeads(
      refreshToken,
      TEST_CUSTOMER_ID,
      TEST_LOGIN_CUSTOMER_ID,
      fromDate,
      toDate,
    );

    const totalLeads = rows.reduce(
      (sum, r) => sum + r.phoneCallCount + r.messageCount + r.bookingCount,
      0,
    );

    return NextResponse.json({
      customerId: TEST_CUSTOMER_ID,
      fromDate,
      toDate,
      dayCount: rows.length,
      totalLeads,
      rows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

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
      { customerId: TEST_CUSTOMER_ID, fromDate, toDate, error: message, errors, inspected },
      { status: 500 },
    );
  }
}
