import { GoogleAdsApi, enums, type Customer } from "google-ads-api";

// Google Ads scope. "adwords" is the only standard scope; permission
// granularity flows from the connected user's role in Google Ads, not from
// the OAuth scope list.
export const GOOGLE_ADS_OAUTH_SCOPES = ["https://www.googleapis.com/auth/adwords"];

export type GoogleAdsEnv = {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  loginCustomerId?: string;
};

function loadEnv(): GoogleAdsEnv {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  // Reuse the existing Google OAuth client if a dedicated one isn't set —
  // most installs run a single OAuth client per Google Cloud project and
  // just toggle scopes per flow.
  const clientId =
    process.env.GOOGLE_ADS_OAUTH_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret =
    process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET ??
    process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!developerToken || !clientId || !clientSecret) {
    throw new Error(
      "Google Ads env not configured: need GOOGLE_ADS_DEVELOPER_TOKEN and a GOOGLE_(ADS_)OAUTH_CLIENT_(ID|SECRET) pair.",
    );
  }
  return {
    developerToken,
    clientId,
    clientSecret,
    loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
  };
}

function newApi(env = loadEnv()): GoogleAdsApi {
  return new GoogleAdsApi({
    client_id: env.clientId,
    client_secret: env.clientSecret,
    developer_token: env.developerToken,
  });
}

// Strip dashes from customer ids (Google sometimes returns them as
// "123-456-7890") because the API client expects bare digits.
function normalizeCustomerId(id: string): string {
  return id.replace(/-/g, "");
}

export type AccessibleCustomer = {
  resourceName: string;
  customerId: string;
};

// After OAuth, returns the list of Google Ads accounts visible to the
// connected user. If exactly one we can auto-link; if multiple the admin
// UI shows a picker.
export async function listAccessibleCustomers(
  refreshToken: string,
): Promise<AccessibleCustomer[]> {
  const api = newApi();
  const resources = await api.listAccessibleCustomers(refreshToken);
  return resources.resource_names.map((rn: string) => ({
    resourceName: rn,
    customerId: rn.replace(/^customers\//, ""),
  }));
}

function getCustomer(refreshToken: string, customerId: string): Customer {
  const env = loadEnv();
  const api = newApi(env);
  return api.Customer({
    customer_id: normalizeCustomerId(customerId),
    refresh_token: refreshToken,
    login_customer_id: env.loginCustomerId
      ? normalizeCustomerId(env.loginCustomerId)
      : undefined,
  });
}

export type AdsDailyMetricsRow = {
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  date: string; // YYYY-MM-DD
  clicks: number;
  impressions: number;
  conversions: number;
  costMicros: bigint;
  phoneCalls: number;
};

// Pulls campaign-level daily metrics for the given date window. Date format
// must be YYYY-MM-DD for GAQL.
export async function pullDailyMetrics(
  refreshToken: string,
  customerId: string,
  fromDate: string,
  toDate: string,
): Promise<AdsDailyMetricsRow[]> {
  const customer = getCustomer(refreshToken, customerId);
  const rows = await customer.query(`
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      segments.date,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions,
      metrics.cost_micros,
      metrics.phone_calls
    FROM campaign
    WHERE segments.date BETWEEN '${fromDate}' AND '${toDate}'
    ORDER BY segments.date
  `);

  return rows.map((r) => {
    const campaign = r.campaign ?? {};
    const segments = r.segments ?? {};
    const metrics = r.metrics ?? {};
    const status =
      typeof campaign.status === "number"
        ? enums.CampaignStatus[campaign.status]
        : String(campaign.status ?? "");
    return {
      campaignId: String(campaign.id ?? ""),
      campaignName: String(campaign.name ?? ""),
      campaignStatus: status,
      date: String(segments.date ?? ""),
      clicks: Number(metrics.clicks ?? 0),
      impressions: Number(metrics.impressions ?? 0),
      conversions: Number(metrics.conversions ?? 0),
      costMicros: BigInt(metrics.cost_micros ?? 0),
      phoneCalls: Number(metrics.phone_calls ?? 0),
    };
  });
}
