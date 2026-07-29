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

export function getCustomer(
  refreshToken: string,
  customerId: string,
  loginCustomerId?: string,
): Customer {
  const env = loadEnv();
  const api = newApi(env);
  const resolvedLoginCustomerId = loginCustomerId ?? env.loginCustomerId;
  return api.Customer({
    customer_id: normalizeCustomerId(customerId),
    refresh_token: refreshToken,
    login_customer_id: resolvedLoginCustomerId
      ? normalizeCustomerId(resolvedLoginCustomerId)
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
//
// opts.extraManagerId is an opt-in escape hatch for managers that never
// show up in listAccessibleCustomers() at all — e.g. a separate LSA MCC
// the refresh token can still reach via an explicit login_customer_id
// override (see getCustomer), but that Google never lists as directly
// accessible to this OAuth user. The loop below only expands managers it
// finds inside `accessible`, so it would never surface such a manager's
// children on its own. Only pass this when you actually want that extra
// probe — existing callers that don't pass it (PPC's discovery) are
// completely unaffected, regardless of whether the underlying env var is
// set anywhere in the deployment.
export async function discoverGoogleAdsCustomers(
  refreshToken: string,
  opts?: { extraManagerId?: string },
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

  if (opts?.extraManagerId) {
    try {
      // customer_id and login_customer_id both set to the manager itself —
      // the standard pattern for querying a manager's own customer_client
      // list when that manager isn't otherwise directly accessible to this
      // refresh token (mirrors how getCustomer() lets a per-client
      // login_customer_id reach a customer the token can't see directly).
      const managerCustomer = getCustomer(
        refreshToken,
        opts.extraManagerId,
        opts.extraManagerId,
      );
      const childRows = (await managerCustomer.query(`
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
        if (id === normalizeCustomerId(opts.extraManagerId)) continue; // skip the manager itself
        if (cc.manager) continue; // skip nested managers
        // Don't overwrite an entry already resolved via the accessible-
        // customers path above — that one may carry a better name.
        if (!byId.has(id)) {
          byId.set(id, { id, name: cc.descriptive_name ?? null });
        }
      }
    } catch {
      // Same fail-soft rationale as the per-customer expansion above — a
      // misconfigured or unreachable manager id shouldn't take down
      // discovery for every other customer.
    }
  }

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

export type LsaCostDailyRow = {
  date: string; // YYYY-MM-DD
  costMicros: bigint;
};

// Pulls daily cost across every LOCAL_SERVICES campaign on the account,
// summed per day (lsa_leads_daily is one row per client per date, not per
// campaign — mirrors pullDailyMetrics's date-window pattern but collapses
// campaigns since the LSA report doesn't break out cost by campaign).
export async function pullLocalServicesCost(
  refreshToken: string,
  customerId: string,
  loginCustomerId: string | undefined,
  fromDate: string,
  toDate: string,
): Promise<LsaCostDailyRow[]> {
  const customer = getCustomer(refreshToken, customerId, loginCustomerId);
  const rows = await customer.query(`
    SELECT campaign.id, campaign.advertising_channel_type, segments.date, metrics.cost_micros
    FROM campaign
    WHERE campaign.advertising_channel_type = 'LOCAL_SERVICES'
      AND segments.date BETWEEN '${fromDate}' AND '${toDate}'
  `);

  const byDate = new Map<string, bigint>();
  for (const r of rows) {
    const segments = r.segments ?? {};
    const metrics = r.metrics ?? {};
    const date = String(segments.date ?? "");
    if (!date) continue;
    byDate.set(date, (byDate.get(date) ?? 0n) + BigInt(metrics.cost_micros ?? 0));
  }

  return Array.from(byDate.entries())
    .map(([date, costMicros]) => ({ date, costMicros }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export type LsaLeadsDailyRow = {
  date: string; // YYYY-MM-DD
  phoneCallCount: number;
  messageCount: number;
  bookingCount: number;
  // Leads Google actually charged for, per lead_charged. Distinct from
  // lead_status — a lead can be credited/refunded after being charged.
  // Captured for future cost reconciliation; not applied to cost anywhere
  // yet.
  chargedCount: number;
  // Counts keyed by LocalServicesLeadStatus name (NEW, ACTIVE, BOOKED,
  // DECLINED, EXPIRED, DISABLED, CONSUMER_DECLINED, WIPED_OUT).
  statusBreakdown: Record<string, number>;
};

// Pulls local_services_lead rows for the window and buckets them by the
// lead's creation day (mirrors callrail.ts's day-bucketing from
// call.start_time). creation_date_time is a full datetime string, not a
// segments.date column, so the BETWEEN bounds include an explicit
// time-of-day range — only DURING LAST_30_DAYS was confirmed live via the
// lsa-test diagnostic; this BETWEEN form follows GAQL's documented
// comparison operators but hasn't itself been exercised against a real
// backfill yet, so it's worth double-checking if a backfilled range comes
// back short.
export async function pullLocalServicesLeads(
  refreshToken: string,
  customerId: string,
  loginCustomerId: string | undefined,
  fromDate: string,
  toDate: string,
): Promise<LsaLeadsDailyRow[]> {
  const customer = getCustomer(refreshToken, customerId, loginCustomerId);
  const rows = await customer.query(`
    SELECT local_services_lead.id, local_services_lead.lead_type,
           local_services_lead.lead_status, local_services_lead.lead_charged,
           local_services_lead.creation_date_time
    FROM local_services_lead
    WHERE local_services_lead.creation_date_time BETWEEN '${fromDate} 00:00:00' AND '${toDate} 23:59:59'
  `);

  const byDate = new Map<string, LsaLeadsDailyRow>();
  for (const r of rows) {
    const lead = (r as { local_services_lead?: Record<string, unknown> }).local_services_lead ?? {};
    const createdAt = String(lead.creation_date_time ?? "");
    const date = createdAt.slice(0, 10);
    if (!date) continue;

    const bucket = byDate.get(date) ?? {
      date,
      phoneCallCount: 0,
      messageCount: 0,
      bookingCount: 0,
      chargedCount: 0,
      statusBreakdown: {},
    };

    const typeName =
      typeof lead.lead_type === "number"
        ? enums.LocalServicesLeadType[lead.lead_type]
        : String(lead.lead_type ?? "");
    if (typeName === "PHONE_CALL") bucket.phoneCallCount += 1;
    else if (typeName === "MESSAGE") bucket.messageCount += 1;
    else if (typeName === "BOOKING") bucket.bookingCount += 1;

    if (lead.lead_charged === true) bucket.chargedCount += 1;

    const statusName =
      typeof lead.lead_status === "number"
        ? enums.LocalServicesLeadStatus[lead.lead_status]
        : String(lead.lead_status ?? "");
    if (statusName) {
      bucket.statusBreakdown[statusName] = (bucket.statusBreakdown[statusName] ?? 0) + 1;
    }

    byDate.set(date, bucket);
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export type CallViewRow = {
  startCallDateTime: string; // "yyyy-MM-dd HH:mm:ss", account time zone
  callDurationSeconds: number;
  callerAreaCode: string;
  campaignId: string;
  campaignName: string;
  // "AD" (called directly from the ad) or "LANDING_PAGE" (clicked the ad,
  // then called from a forwarding number Google swapped onto the landing
  // page) — under investigation for whether this maps to the "Ad" vs
  // "Website" source distinction visible in Google Ads' own UI, and
  // whether call_view actually returns both kinds or only ever "AD" for
  // a given account. Raw numeric fallback (e.g. "2") if the enums export
  // doesn't recognize the value, rather than risking a wrong/nonexistent
  // enum name silently mislabeling it.
  callTrackingDisplayLocation: string;
};

function decodeCallTrackingDisplayLocation(raw: unknown): string {
  if (typeof raw !== "number") return String(raw ?? "");
  const enumMap = (enums as Record<string, Record<number, string> | undefined>)
    .CallTrackingDisplayLocation;
  return enumMap?.[raw] ?? String(raw);
}

// Pulls Google Ads' call_view resource — calls placed via a call
// extension/call-only ad — for cross-referencing against CallRail calls to
// determine ad-driven vs organic (see callrail.ts). Confirmed live against
// a real account: call_view rejects segments.date entirely in SELECT or
// WHERE (PROHIBITED_SEGMENT_IN_SELECT_OR_WHERE_CLAUSE) — it isn't
// date-filterable the way campaign/local_services_lead are. campaign.id/
// campaign.name are call_view's documented "Attributed Resources"
// (selectable/filterable, but don't segment the result set), which is why
// only those two (not segments.*) appear in the WHERE-less query below.
//
// Since there's no server-side date bound, we pull the most recent rows
// instead (capped + ordered) and let the caller bucket by date itself —
// confirmed live that a real account only carries ~28 call_view rows
// total going back a year, so this cap is a safety margin for a future
// high-volume account, not something expected to bind today.
export async function pullCallViewRows(
  refreshToken: string,
  customerId: string,
): Promise<CallViewRow[]> {
  const customer = getCustomer(refreshToken, customerId);
  const rows = await customer.query(`
    SELECT
      call_view.start_call_date_time,
      call_view.call_duration_seconds,
      call_view.caller_area_code,
      call_view.call_tracking_display_location,
      campaign.id,
      campaign.name
    FROM call_view
    ORDER BY call_view.start_call_date_time DESC
    LIMIT 1000
  `);

  return rows.map((r) => {
    const callView = (r as { call_view?: Record<string, unknown> }).call_view ?? {};
    const campaign = r.campaign ?? {};
    return {
      startCallDateTime: String(callView.start_call_date_time ?? ""),
      callDurationSeconds: Number(callView.call_duration_seconds ?? 0),
      callerAreaCode: String(callView.caller_area_code ?? ""),
      campaignId: String(campaign.id ?? ""),
      campaignName: String(campaign.name ?? ""),
      callTrackingDisplayLocation: decodeCallTrackingDisplayLocation(
        callView.call_tracking_display_location,
      ),
    };
  });
}
