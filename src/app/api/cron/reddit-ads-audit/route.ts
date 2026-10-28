import { NextResponse } from "next/server";
import { daysAgoIsoEastern, easternWallClockToDate } from "@/lib/date-utils";
import {
  getAdAccount,
  getRedditMe,
  listBusinessAdAccounts,
  listMyBusinesses,
  queryBusinessAdAccounts,
  runAdAccountReport,
  spendMicrosToDollars,
  toRedditReportHour,
  type RedditAdAccount,
  type RedditReportRequest,
} from "@/lib/reddit-ads";
import { getRedditAccessToken, listRedditCredentials } from "@/lib/reddit-ads-token";

export const runtime = "nodejs";
export const maxDuration = 300;

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const NY = "America/New_York";

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const utcMidnight = (iso: string) => `${iso}T00:00:00Z`;

function nyMidnight(iso: string): string {
  const d = easternWallClockToDate(`${iso} 00:00:00`);
  if (!d) throw new Error(`Bad date: ${iso}`);
  return toRedditReportHour(d);
}

function summarizeAccount(a: RedditAdAccount, foundUnderBusinessId: string) {
  return {
    id: a.id,
    name: a.name,
    business_id: a.business_id,
    // An account whose owner isn't the business it was listed under is
    // shared with us rather than owned.
    ownedByListingBusiness: a.business_id === foundUnderBusinessId,
    currency: a.currency,
    time_zone_id: a.time_zone_id,
    type: a.type,
  };
}

// Temporary read-only diagnostic for the Reddit Ads spend report. Answers
// two questions against the live account before the sync gets built on an
// assumption:
//
// 1. Shared/partnership accounts. GET /businesses/{id}/ad_accounts is
//    documented as excluding accounts shared with the business; POST
//    .../ad_accounts/query carries no such note. Lists both per business
//    and diffs them, and ?probe=<id>,<id> tries GET /ad_accounts/{id}
//    directly for accounts discovery misses (e.g. 1Georgia).
//
// 2. Which parameter sets the report's day boundary. starts_at/ends_at
//    must be whole UTC hours and time_zone_id is separate; the docs don't
//    say how they interact. ?tzAccount=<id>[&tzDate=YYYY-MM-DD] pulls the
//    same day six ways — compare each variant's spendOnDate with the
//    Reddit dashboard's figure for that day.
//
// Optional ?credential=<reddit username> picks a connection when more
// than one is stored (default: the most recently connected).
//
// The only write is the access-token cache in oauth_credentials when the
// token needs refreshing. Not registered in vercel.json. Delete once both
// questions are answered.
export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const credentialParam = url.searchParams.get("credential");
  const probeIds = (url.searchParams.get("probe") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const tzAccount = url.searchParams.get("tzAccount");
  const tzDate = url.searchParams.get("tzDate") ?? daysAgoIsoEastern(3);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tzDate)) {
    return NextResponse.json({ error: "tzDate must be YYYY-MM-DD" }, { status: 400 });
  }

  const credentials = await listRedditCredentials();
  const cred = credentialParam
    ? credentials.find((c) => c.accountEmail === credentialParam)
    : credentials[0];
  const out: Record<string, unknown> = {
    credentials: credentials.map((c) => ({
      username: c.accountEmail,
      connectedAt: c.updatedAt,
      accessTokenExpiresAt: c.expiresAt,
    })),
  };
  if (!cred) {
    return NextResponse.json({ ...out, error: "No matching reddit_ads credential" }, { status: 404 });
  }
  out.using = cred.accountEmail;

  let token: string;
  try {
    token = await getRedditAccessToken(cred);
  } catch (e) {
    return NextResponse.json({ ...out, error: `Token refresh failed: ${errorText(e)}` }, { status: 502 });
  }

  try {
    out.me = await getRedditMe(token);
  } catch (e) {
    out.me = { error: errorText(e) };
  }

  // --- 1. Discovery -------------------------------------------------------
  const allAccounts = new Map<string, ReturnType<typeof summarizeAccount> & { sources: string[] }>();
  const noteAccount = (a: RedditAdAccount, businessId: string, source: string) => {
    const existing = allAccounts.get(a.id);
    if (existing) existing.sources.push(source);
    else allAccounts.set(a.id, { ...summarizeAccount(a, businessId), sources: [source] });
  };

  try {
    const { items: businesses, pages } = await listMyBusinesses(token);
    const perBusiness = [];
    for (const b of businesses) {
      const entry: Record<string, unknown> = { id: b.id, name: b.name };
      let listIds: string[] | null = null;
      let queryIds: string[] | null = null;
      try {
        const res = await listBusinessAdAccounts(token, b.id);
        listIds = res.items.map((a) => a.id);
        res.items.forEach((a) => noteAccount(a, b.id, `list:${b.name}`));
        entry.list = { pages: res.pages, accounts: res.items.map((a) => summarizeAccount(a, b.id)) };
      } catch (e) {
        entry.list = { error: errorText(e) };
      }
      try {
        const res = await queryBusinessAdAccounts(token, b.id);
        queryIds = res.items.map((a) => a.id);
        res.items.forEach((a) => noteAccount(a, b.id, `query:${b.name}`));
        entry.query = { pages: res.pages, accounts: res.items.map((a) => summarizeAccount(a, b.id)) };
      } catch (e) {
        entry.query = { error: errorText(e) };
      }
      if (listIds && queryIds) {
        entry.onlyInQuery = queryIds.filter((id) => !listIds.includes(id));
        entry.onlyInList = listIds.filter((id) => !queryIds.includes(id));
      }
      perBusiness.push(entry);
    }
    out.businesses = { pages, items: perBusiness };
  } catch (e) {
    out.businesses = { error: errorText(e) };
  }

  out.probes = [];
  for (const id of probeIds) {
    try {
      const a = await getAdAccount(token, id);
      (out.probes as unknown[]).push({ id, account: a });
    } catch (e) {
      (out.probes as unknown[]).push({ id, error: errorText(e) });
    }
  }

  const accounts = [...allAccounts.values()];
  out.allAccounts = accounts;
  out.nonUsdAccounts = accounts.filter((a) => a.currency && a.currency !== "USD");

  // --- 2. Day boundary ----------------------------------------------------
  if (tzAccount) {
    const prev = addDays(tzDate, -1);
    const next = addDays(tzDate, 1);
    const after = addDays(tzDate, 2);
    const variants: Array<{ name: string; req: RedditReportRequest }> = [
      {
        name: "A: UTC-midnight bounds, time_zone_id=NY",
        req: { breakdowns: ["DATE"], fields: ["SPEND"], startsAt: utcMidnight(tzDate), endsAt: utcMidnight(next), timeZoneId: NY },
      },
      {
        name: "B: NY-midnight bounds (as UTC), time_zone_id=NY",
        req: { breakdowns: ["DATE"], fields: ["SPEND"], startsAt: nyMidnight(tzDate), endsAt: nyMidnight(next), timeZoneId: NY },
      },
      {
        name: "C: UTC-midnight bounds, no time_zone_id (UTC default)",
        req: { breakdowns: ["DATE"], fields: ["SPEND"], startsAt: utcMidnight(tzDate), endsAt: utcMidnight(next) },
      },
      {
        name: "D: 3-day window, time_zone_id=NY",
        req: { breakdowns: ["DATE"], fields: ["SPEND"], startsAt: utcMidnight(prev), endsAt: utcMidnight(after), timeZoneId: NY },
      },
      {
        name: "E: 3-day window, no time_zone_id",
        req: { breakdowns: ["DATE"], fields: ["SPEND"], startsAt: utcMidnight(prev), endsAt: utcMidnight(after) },
      },
      {
        name: "F: 3-day window by HOUR, time_zone_id=NY",
        req: { breakdowns: ["HOUR"], fields: ["SPEND"], startsAt: utcMidnight(prev), endsAt: utcMidnight(after), timeZoneId: NY },
      },
    ];
    const results = [];
    for (const v of variants) {
      try {
        const { items, pages } = await runAdAccountReport(token, tzAccount, v.req);
        const rows = items.map((r) => ({
          date: r.date ?? null,
          hour: r.hour ?? null,
          spend: spendMicrosToDollars(r.spend),
        }));
        results.push({
          name: v.name,
          request: v.req,
          pages,
          totalSpend: rows.reduce((s, r) => s + r.spend, 0),
          spendOnDate: rows.filter((r) => r.date === tzDate).reduce((s, r) => s + r.spend, 0),
          rows,
          firstRawRow: items[0] ?? null,
        });
      } catch (e) {
        results.push({ name: v.name, request: v.req, error: errorText(e) });
      }
    }
    out.timeZoneCheck = {
      account: allAccounts.get(tzAccount) ?? { id: tzAccount },
      date: tzDate,
      howToRead:
        "Compare each variant's spendOnDate (and A/B/C's totalSpend) with the Reddit dashboard's spend for this date. The dashboard reports in the account's own time zone (account.time_zone_id), so pick an account set to America/New_York if one exists.",
      variants: results,
    };
  }

  return NextResponse.json(out);
}
