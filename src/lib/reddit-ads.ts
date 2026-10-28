// Reddit Ads API v3 client. Pure API wrapper — no DB access (token storage
// and refresh caching live in reddit-ads-token.ts), same split as gbp.ts.
//
// Schemas: https://ads-api.reddit.com/api/v3/openapi.json. Every endpoint
// used here is documented as needing only the `adsread` scope.

export const REDDIT_ADS_API_BASE = "https://ads-api.reddit.com/api/v3";
export const REDDIT_AUTHORIZE_URL = "https://www.reddit.com/api/v1/authorize";
export const REDDIT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
export const REDDIT_ADS_SCOPE = "adsread";

// Pagination `next_url`s are followed verbatim (the docs forbid building
// them from query params), but the bearer token must never be sent to a
// host other than the Ads API itself.
const API_ORIGIN = new URL(REDDIT_ADS_API_BASE).origin;

const MAX_RETRIES = 4;
const MAX_WAIT_SECONDS = 60;

// Reddit throttles default User-Agents, and its API rules want
// "<platform>:<app id>:<version> (by /u/<username>)". Required rather than
// defaulted so a missing value fails loudly instead of quietly throttling.
export function redditUserAgent(): string {
  const ua = process.env.REDDIT_ADS_USER_AGENT;
  if (!ua) throw new Error("REDDIT_ADS_USER_AGENT is not set");
  return ua;
}

export function redditAppCredentials(): { appId: string; secret: string } {
  const appId = process.env.REDDIT_ADS_APP_ID;
  const secret = process.env.REDDIT_ADS_APP_SECRET;
  if (!appId || !secret) {
    throw new Error("REDDIT_ADS_APP_ID / REDDIT_ADS_APP_SECRET not set");
  }
  return { appId, secret };
}

export function buildRedditAuthorizeUrl({
  appId,
  redirectUri,
  state,
}: {
  appId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(REDDIT_AUTHORIZE_URL);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", redirectUri);
  // permanent = Reddit issues a refresh token; temporary tokens die in an hour.
  url.searchParams.set("duration", "permanent");
  url.searchParams.set("scope", REDDIT_ADS_SCOPE);
  return url.toString();
}

export type RedditTokenResponse = {
  accessToken: string;
  // Only present on the authorization_code exchange in practice; a refresh
  // may or may not echo one back, so callers keep the stored one if absent.
  refreshToken: string | null;
  expiresIn: number;
  scope: string | null;
};

async function postTokenEndpoint(form: Record<string, string>): Promise<RedditTokenResponse> {
  const { appId, secret } = redditAppCredentials();
  const res = await fetch(REDDIT_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${appId}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": redditUserAgent(),
    },
    body: new URLSearchParams(form),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // fall through to the error below with the raw text
  }
  // Reddit's token endpoint can answer HTTP 200 with {"error": "..."} (e.g.
  // invalid_grant), so a 2xx alone isn't success.
  if (!res.ok || typeof body.access_token !== "string") {
    const detail = typeof body.error === "string" ? body.error : text.slice(0, 300);
    throw new Error(`Reddit token request failed (HTTP ${res.status}): ${detail}`);
  }
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    expiresIn: typeof body.expires_in === "number" ? body.expires_in : 3600,
    scope: typeof body.scope === "string" ? body.scope : null,
  };
}

export function exchangeRedditCode({
  code,
  redirectUri,
}: {
  code: string;
  redirectUri: string;
}): Promise<RedditTokenResponse> {
  return postTokenEndpoint({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
}

export function refreshRedditAccessToken(refreshToken: string): Promise<RedditTokenResponse> {
  return postTokenEndpoint({ grant_type: "refresh_token", refresh_token: refreshToken });
}

// --- Rate limiting ----------------------------------------------------------

// Reddit sends the IETF draft `RateLimit` header ("policy";r=<remaining>;
// t=<seconds to reset>) on 429s. The older split-header form
// (RateLimit-Remaining / RateLimit-Reset) and Retry-After are read too in
// case either shows up — the spec only documents the 429 case, so being
// liberal here costs nothing.
export function parseRateLimit(headers: Headers): {
  remaining: number | null;
  resetSeconds: number | null;
} {
  let remaining: number | null = null;
  let resetSeconds: number | null = null;
  const combined = headers.get("ratelimit");
  if (combined) {
    const r = combined.match(/(?:^|[;,\s])r=(\d+)/);
    const t = combined.match(/(?:^|[;,\s])t=(\d+)/);
    if (r) remaining = Number(r[1]);
    if (t) resetSeconds = Number(t[1]);
  }
  const splitRemaining = headers.get("ratelimit-remaining");
  const splitReset = headers.get("ratelimit-reset");
  if (remaining == null && splitRemaining && /^\d+$/.test(splitRemaining)) {
    remaining = Number(splitRemaining);
  }
  if (resetSeconds == null && splitReset && /^\d+$/.test(splitReset)) {
    resetSeconds = Number(splitReset);
  }
  const retryAfter = headers.get("retry-after");
  if (resetSeconds == null && retryAfter && /^\d+$/.test(retryAfter)) {
    resetSeconds = Number(retryAfter);
  }
  return { remaining, resetSeconds };
}

// Swappable so tests don't actually wait.
export const rateLimitClock = {
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

export class RedditApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "RedditApiError";
  }
}

async function redditRequest<T>(
  accessToken: string,
  method: "GET" | "POST",
  url: string,
  body?: unknown,
): Promise<T> {
  if (new URL(url).origin !== API_ORIGIN) {
    throw new Error(`Refusing to send Reddit credentials to ${new URL(url).origin}`);
  }
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": redditUserAgent(),
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const { remaining, resetSeconds } = parseRateLimit(res.headers);
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const waitSeconds = Math.min(resetSeconds ?? 2 ** (attempt + 1), MAX_WAIT_SECONDS);
      await rateLimitClock.sleep(waitSeconds * 1000);
      continue;
    }
    const text = await res.text();
    if (!res.ok) {
      throw new RedditApiError(
        `Reddit Ads API ${method} ${new URL(url).pathname} failed: HTTP ${res.status} ${text.slice(0, 300)}`,
        res.status,
        text,
      );
    }
    // Quota spent but the request went through: wait out the window now
    // rather than eating a 429 on the next call.
    if (remaining === 0 && resetSeconds != null) {
      await rateLimitClock.sleep(Math.min(resetSeconds, MAX_WAIT_SECONDS) * 1000);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }
}

type Page<T> = { data: T[]; pagination?: { next_url?: string | null } | null };

// Follows pagination.next_url only — never rebuilds pages from query params
// (the docs say not to). POST endpoints re-send the same body to next_url.
async function collectPages<T>(
  accessToken: string,
  method: "GET" | "POST",
  url: string,
  body?: unknown,
): Promise<{ items: T[]; pages: number }> {
  const items: T[] = [];
  let next: string | null = url;
  let pages = 0;
  while (next) {
    const page: Page<T> = await redditRequest<Page<T>>(accessToken, method, next, body);
    items.push(...(page.data ?? []));
    pages++;
    next = page.pagination?.next_url ?? null;
  }
  return { items, pages };
}

// --- Endpoints --------------------------------------------------------------

export type RedditMe = {
  id: string;
  type: "MEMBER" | "SYSTEM_USER";
  reddit_username: string;
  email: string | null;
};

export type RedditBusiness = { id: string; name: string };

export type RedditAdAccount = {
  id: string;
  name: string;
  business_id: string | null;
  currency: string | null;
  time_zone_id: string | null;
  type: string | null;
};

export async function getRedditMe(accessToken: string): Promise<RedditMe> {
  const res = await redditRequest<{ data: RedditMe }>(accessToken, "GET", `${REDDIT_ADS_API_BASE}/me`);
  return res.data;
}

export function listMyBusinesses(accessToken: string) {
  return collectPages<RedditBusiness>(accessToken, "GET", `${REDDIT_ADS_API_BASE}/me/businesses`);
}

// Documented as NOT returning ad accounts shared with the business.
export function listBusinessAdAccounts(accessToken: string, businessId: string) {
  return collectPages<RedditAdAccount>(
    accessToken,
    "GET",
    `${REDDIT_ADS_API_BASE}/businesses/${encodeURIComponent(businessId)}/ad_accounts`,
  );
}

// No "shared accounts excluded" note, and its role filter accepts
// PARTNER_* roles — whether that means it returns partner-shared accounts
// is unconfirmed until checked live.
export function queryBusinessAdAccounts(accessToken: string, businessId: string) {
  return collectPages<RedditAdAccount>(
    accessToken,
    "POST",
    `${REDDIT_ADS_API_BASE}/businesses/${encodeURIComponent(businessId)}/ad_accounts/query`,
    { data: {} },
  );
}

export async function getAdAccount(accessToken: string, adAccountId: string): Promise<RedditAdAccount> {
  const res = await redditRequest<{ data: RedditAdAccount }>(
    accessToken,
    "GET",
    `${REDDIT_ADS_API_BASE}/ad_accounts/${encodeURIComponent(adAccountId)}`,
  );
  return res.data;
}

export type RedditReportRow = {
  date?: string | null;
  hour?: string | null;
  ad_account_id?: string | null;
  spend?: number | null;
};

export type RedditReportRequest = {
  breakdowns: string[];
  fields: string[];
  // Must be "YYYY-MM-DDTHH:00:00Z" — the API only accepts hourly granularity.
  startsAt: string;
  endsAt: string;
  timeZoneId?: string;
};

// Report responses nest rows under data.metrics rather than a bare data
// array, so they can't go through collectPages.
export async function runAdAccountReport(
  accessToken: string,
  adAccountId: string,
  req: RedditReportRequest,
): Promise<{ items: RedditReportRow[]; pages: number }> {
  const body = {
    data: {
      breakdowns: req.breakdowns,
      fields: req.fields,
      starts_at: req.startsAt,
      ends_at: req.endsAt,
      ...(req.timeZoneId ? { time_zone_id: req.timeZoneId } : {}),
    },
  };
  const items: RedditReportRow[] = [];
  let next: string | null =
    `${REDDIT_ADS_API_BASE}/ad_accounts/${encodeURIComponent(adAccountId)}/reports`;
  let pages = 0;
  while (next) {
    const page: { data?: { metrics?: RedditReportRow[] }; pagination?: { next_url?: string | null } | null } =
      await redditRequest(accessToken, "POST", next, body);
    items.push(...(page.data?.metrics ?? []));
    pages++;
    next = page.pagination?.next_url ?? null;
  }
  return { items, pages };
}

// SPEND comes back in micros of the account currency.
export function spendMicrosToDollars(micros: number | null | undefined): number {
  return (micros ?? 0) / 1_000_000;
}

// Formats an instant as the hour-granular UTC string the reports endpoint
// demands ("YYYY-MM-DDTHH:00:00Z"). Throws on a non-whole-hour instant
// rather than silently truncating it.
export function toRedditReportHour(d: Date): string {
  if (d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0 || d.getUTCMilliseconds() !== 0) {
    throw new Error(`Not a whole UTC hour: ${d.toISOString()}`);
  }
  return `${d.toISOString().slice(0, 13)}:00:00Z`;
}
