import { decryptString } from "./crypto";

export type GbpLocationMatch = {
  accountId: string;
  locationId: string;
};

// Lists GBP accounts the OAuth user has access to, then scans each account's
// locations for one whose placeId matches `placeId`. Returns the first match
// or null. Failures bubble up so the caller can decide how to surface them.
export async function findGbpLocationByPlaceId({
  refreshTokenEncrypted,
  placeId,
}: {
  refreshTokenEncrypted: string;
  placeId: string;
}): Promise<GbpLocationMatch | null> {
  const token = await getAccessToken(refreshTokenEncrypted);
  const accountsRes = await fetch(
    "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!accountsRes.ok) {
    throw new Error(`GBP accounts fetch failed: ${accountsRes.status} ${await accountsRes.text()}`);
  }
  const accountsJson = (await accountsRes.json()) as {
    accounts?: Array<{ name: string }>;
  };

  for (const acct of accountsJson.accounts ?? []) {
    const accountId = acct.name.replace(/^accounts\//, "");
    let pageToken: string | undefined;
    do {
      const url = new URL(
        `https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${accountId}/locations`,
      );
      url.searchParams.set("readMask", "name,metadata");
      url.searchParams.set("pageSize", "100");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(`GBP locations fetch failed: ${res.status} ${await res.text()}`);
      }
      const json = (await res.json()) as {
        locations?: Array<{ name: string; metadata?: { placeId?: string } }>;
        nextPageToken?: string;
      };
      for (const loc of json.locations ?? []) {
        if (loc.metadata?.placeId === placeId) {
          return {
            accountId,
            locationId: loc.name.replace(/^locations\//, ""),
          };
        }
      }
      pageToken = json.nextPageToken;
    } while (pageToken);
  }
  return null;
}

// The full set of daily metrics exposed by Google Business Profile
// Performance API. We pull all of them so the dashboard can present any
// vertical's "useful" set; rendering decides which to show.
export const PERFORMANCE_METRICS = [
  "CALL_CLICKS",
  "WEBSITE_CLICKS",
  "BUSINESS_DIRECTION_REQUESTS",
  "BUSINESS_CONVERSATIONS",
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "BUSINESS_BOOKINGS",
  "BUSINESS_FOOD_ORDERS",
  "BUSINESS_FOOD_MENU_CLICKS",
] as const;

export type PerformanceMetric = (typeof PERFORMANCE_METRICS)[number];

export type DailyMetricValue = { date: string; value: number };
export type PerformanceTimeSeries = {
  metric: PerformanceMetric;
  values: DailyMetricValue[];
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export async function fetchPerformanceMetrics({
  locationId,
  refreshTokenEncrypted,
  startDate,
  endDate,
}: {
  locationId: string;
  refreshTokenEncrypted: string;
  startDate: Date;
  endDate: Date;
}): Promise<PerformanceTimeSeries[]> {
  const token = await getAccessToken(refreshTokenEncrypted);
  const url = new URL(
    `https://businessprofileperformance.googleapis.com/v1/locations/${locationId}:fetchMultiDailyMetricsTimeSeries`,
  );
  for (const m of PERFORMANCE_METRICS) url.searchParams.append("dailyMetrics", m);
  url.searchParams.set("dailyRange.start_date.year", String(startDate.getUTCFullYear()));
  url.searchParams.set("dailyRange.start_date.month", String(startDate.getUTCMonth() + 1));
  url.searchParams.set("dailyRange.start_date.day", String(startDate.getUTCDate()));
  url.searchParams.set("dailyRange.end_date.year", String(endDate.getUTCFullYear()));
  url.searchParams.set("dailyRange.end_date.month", String(endDate.getUTCMonth() + 1));
  url.searchParams.set("dailyRange.end_date.day", String(endDate.getUTCDate()));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`GBP performance fetch failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as {
    multiDailyMetricTimeSeries?: Array<{
      dailyMetricTimeSeries?: Array<{
        dailyMetric: string;
        timeSeries?: {
          datedValues?: Array<{
            date: { year: number; month: number; day: number };
            value?: string;
          }>;
        };
      }>;
    }>;
  };

  const out: PerformanceTimeSeries[] = [];
  for (const wrap of json.multiDailyMetricTimeSeries ?? []) {
    for (const series of wrap.dailyMetricTimeSeries ?? []) {
      out.push({
        metric: series.dailyMetric as PerformanceMetric,
        values:
          series.timeSeries?.datedValues?.map((dv) => ({
            date: `${dv.date.year}-${pad2(dv.date.month)}-${pad2(dv.date.day)}`,
            value: Number(dv.value ?? 0),
          })) ?? [],
      });
    }
  }
  return out;
}

export type GbpReview = {
  reviewId: string;
  rating: number;
  text: string | null;
  reviewerName: string | null;
  reviewerPhotoUrl: string | null;
  createdAt: string;
  updatedAt: string;
  reply?: { text: string; updatedAt: string } | null;
};

const STAR_RATING_MAP: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

export async function getAccessToken(refreshTokenEncrypted: string): Promise<string> {
  const refreshToken = decryptString(refreshTokenEncrypted);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

export type GbpAccount = { name: string; accountName?: string; type?: string; role?: string };
export type GbpLocation = {
  name: string;
  title?: string;
  storefrontAddress?: { addressLines?: string[]; locality?: string; administrativeArea?: string };
  metadata?: { placeId?: string };
};

// Carries the HTTP status so callers can react to a specific one (a 404 from
// the reviews endpoint means the stored account/location pair is stale).
export class GbpHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "GbpHttpError";
  }
}

export type GbpPlaceIndex = {
  // placeId -> where that listing lives right now.
  byPlaceId: Map<string, { accountId: string; locationId: string }>;
  // Accounts whose locations couldn't be listed. A place missing from
  // byPlaceId may live in one of them, so "not found" isn't conclusive.
  failedAccounts: string[];
};

// Every listing the connected Google login can see, across all its accounts
// and location groups, keyed by placeId. Google can move a listing to another
// account or location group, after which the account/location pair we saved
// at connect time returns 404; this is how we find where it went.
export async function buildGbpPlaceIndex(accessToken: string): Promise<GbpPlaceIndex> {
  const byPlaceId: GbpPlaceIndex["byPlaceId"] = new Map();
  const failedAccounts: string[] = [];
  for (const account of await listAccounts(accessToken)) {
    if (!account.name) continue;
    let gbpLocations: GbpLocation[];
    try {
      gbpLocations = await listLocations(accessToken, account.name);
    } catch {
      failedAccounts.push(account.name);
      continue;
    }
    for (const loc of gbpLocations) {
      const placeId = loc.metadata?.placeId;
      if (!placeId || !loc.name || byPlaceId.has(placeId)) continue;
      byPlaceId.set(placeId, {
        accountId: account.name.replace(/^accounts\//, ""),
        locationId: loc.name.replace(/^locations\//, ""),
      });
    }
  }
  return { byPlaceId, failedAccounts };
}

export async function listAccounts(accessToken: string): Promise<GbpAccount[]> {
  const out: GbpAccount[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL("https://mybusinessaccountmanagement.googleapis.com/v1/accounts");
    url.searchParams.set("pageSize", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`GBP listAccounts failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { accounts?: GbpAccount[]; nextPageToken?: string };
    if (json.accounts) out.push(...json.accounts);
    pageToken = json.nextPageToken;
  } while (pageToken);
  return out;
}

export async function listLocations(
  accessToken: string,
  accountResourceName: string,
): Promise<GbpLocation[]> {
  const out: GbpLocation[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${accountResourceName}/locations`,
    );
    url.searchParams.set("readMask", "name,title,storefrontAddress,metadata");
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`GBP listLocations failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { locations?: GbpLocation[]; nextPageToken?: string };
    if (json.locations) out.push(...json.locations);
    pageToken = json.nextPageToken;
  } while (pageToken);
  return out;
}

// TEMPORARY — one entry per page fetched, so the caller can persist real
// per-page data instead of inferring from aggregate before/after counts.
// Drop this (and gbpFetchDiagnostics in schema.ts) once the recurring
// partial-sweep root cause is confirmed. gbp.ts otherwise never touches the
// DB — this stays a plain return value so that separation holds; reviews.ts
// is the one that persists it.
export type GbpFetchPageDiagnostic = {
  pageNumber: number;
  pageReviewCount: number;
  hasNextPageToken: boolean;
  responseStatus: number;
  responseHeaders: Record<string, string>;
};

export async function fetchReviews({
  accountId,
  locationId,
  refreshTokenEncrypted,
  updatedSince,
  fullSweep = false,
}: {
  accountId: string;
  locationId: string;
  refreshTokenEncrypted: string;
  updatedSince?: Date;
  // When true, ignores `updatedSince` and paginates to the end regardless of
  // updateTime, so the caller gets every review GBP currently returns (not
  // just what changed since the last poll). Needed for takedown detection:
  // a review that's still there but unchanged would never show up again
  // under the updatedSince early-exit, so we'd never notice it was seen.
  fullSweep?: boolean;
}): Promise<{ reviews: GbpReview[]; pageDiagnostics: GbpFetchPageDiagnostic[] }> {
  const token = await getAccessToken(refreshTokenEncrypted);
  const out: GbpReview[] = [];
  const pageDiagnostics: GbpFetchPageDiagnostic[] = [];
  let pageToken: string | undefined;
  let pageNumber = 0;

  do {
    pageNumber++;
    const url = new URL(
      `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/reviews`,
    );
    url.searchParams.set("pageSize", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new GbpHttpError(`GBP reviews fetch failed: ${res.status} ${await res.text()}`, res.status);
    }
    const json = (await res.json()) as {
      reviews?: Array<{
        reviewId: string;
        starRating: string;
        comment?: string;
        reviewer?: { displayName?: string; profilePhotoUrl?: string };
        createTime: string;
        updateTime: string;
        reviewReply?: { comment?: string; updateTime?: string };
      }>;
      nextPageToken?: string;
    };
    const pageReviews = json.reviews ?? [];
    pageDiagnostics.push({
      pageNumber,
      pageReviewCount: pageReviews.length,
      hasNextPageToken: Boolean(json.nextPageToken),
      responseStatus: res.status,
      responseHeaders: Object.fromEntries(res.headers.entries()),
    });

    for (const r of pageReviews) {
      if (!fullSweep && updatedSince && new Date(r.updateTime) <= updatedSince) {
        return { reviews: out, pageDiagnostics };
      }
      out.push({
        reviewId: r.reviewId,
        rating: STAR_RATING_MAP[r.starRating] ?? 0,
        text: r.comment ?? null,
        reviewerName: r.reviewer?.displayName ?? null,
        reviewerPhotoUrl: r.reviewer?.profilePhotoUrl ?? null,
        createdAt: r.createTime,
        updatedAt: r.updateTime,
        reply: r.reviewReply
          ? { text: r.reviewReply.comment ?? "", updatedAt: r.reviewReply.updateTime ?? "" }
          : null,
      });
    }
    pageToken = json.nextPageToken;
  } while (pageToken);

  return { reviews: out, pageDiagnostics };
}
