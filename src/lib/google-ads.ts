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

export type DiscoveredCustomer = {
  id: string;
  name: string | null;
};

// Resolve every customer id the OAuth user can see, plus best-effort
// descriptive names. Used to populate the customer-id dropdown on the
// PPC client admin page so operators pick instead of typing digits.
//
// We also expand any manager (MCC) accounts via customer_client to surface
// their children — typical agency setup is one MCC with many child clients
// and we don't want the operator to have to know each child's id.
export async function discoverGoogleAdsCustomers(
  refreshToken: string,
): Promise<DiscoveredCustomer[]> {
  const accessible = await listAccessibleCustomers(refreshToken);
  // Map by id so MCC expansion doesn't introduce duplicates.
  const byId = new Map<string, DiscoveredCustomer>();
  for (const c of accessible) {
    byId.set(c.customerId, { id: c.customerId, name: null });
  }
  // For each accessible customer, try to pull its descriptive name and (if
  // it's a manager) its children. Failures are skipped per-customer so a
  // single permissioning glitch doesn't kill the whole list.
  await Promise.all(
    accessible.map(async (c) => {
      try {
        const customer = getCustomer(refreshToken, c.customerId);
        // Descriptive name + manager flag for this customer itself.
        const selfRows = (await customer.query(`
          SELECT customer.id, customer.descriptive_name, customer.manager
          FROM customer
        `)) as Array<{
          customer?: {
            id?: string | number | null;
            descriptive_name?: string | null;
            manager?: boolean | null;
          };
        }>;
        const self = selfRows[0]?.customer;
        if (self) {
          byId.set(c.customerId, {
            id: c.customerId,
            name: self.descriptive_name ?? null,
          });
          if (self.manager) {
            // Expand children one level. Direct children only — agency MCCs
            // typically don't nest beyond that and recursive expansion adds
            // a lot of cost for little payoff.
            const childRows = (await customer.query(`
              SELECT
                customer_client.id,
                customer_client.descriptive_name,
                customer_client.level,
                customer_client.manager
              FROM customer_client
              WHERE customer_client.level <= 1
            `)) as Array<{
              customer_client?: {
                id?: string | number | null;
                descriptive_name?: string | null;
                manager?: boolean | null;
              };
            }>;
            for (const r of childRows) {
              const cc = r.customer_client;
              if (!cc?.id) continue;
              const id = normalizeCustomerId(String(cc.id));
              if (id === c.customerId) continue; // skip self
              if (cc.manager) continue; // skip nested managers
              byId.set(id, {
                id,
                name: cc.descriptive_name ?? null,
              });
            }
          }
        }
      } catch {
        // Leave the entry with name=null so the dropdown still shows the
        // bare id and the operator can pick it.
      }
    }),
  );
  return Array.from(byId.values()).sort((a, b) => {
    const an = a.name ?? "";
    const bn = b.name ?? "";
    if (an && bn) return an.localeCompare(bn);
    if (an) return -1;
    if (bn) return 1;
    return a.id.localeCompare(b.id);
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
