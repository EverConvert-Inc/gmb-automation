import { GoogleAdsApi, enums, type Customer } from "google-ads-api";
import type { BudgetCampaignRow } from "./ads-account-health";

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
  advertisingChannelType: string;
  date: string; // YYYY-MM-DD
  clicks: number;
  impressions: number;
  conversions: number;
  conversionsValue: number;
  costMicros: bigint;
  phoneCalls: number;
};

// Pulls campaign-level daily metrics for the given date window. Date format
// must be YYYY-MM-DD for GAQL.
//
// Deliberately NOT filtered on campaign.status: that field reflects the
// campaign's CURRENT status, not its status on the historical date being
// queried, so combining it with segments.date silently drops real
// historical spend/clicks/conversions from any campaign that was enabled
// during the window but has since been paused or removed — a genuine
// cost/report accuracy bug this app shipped with for a while (caught via a
// client cost mismatch vs. the Google Ads UI, which has no such gap).
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
      campaign.advertising_channel_type,
      segments.date,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions,
      metrics.conversions_value,
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
    const channelType =
      typeof campaign.advertising_channel_type === "number"
        ? enums.AdvertisingChannelType[campaign.advertising_channel_type]
        : String(campaign.advertising_channel_type ?? "");
    return {
      campaignId: String(campaign.id ?? ""),
      campaignName: String(campaign.name ?? ""),
      campaignStatus: status,
      advertisingChannelType: channelType,
      date: String(segments.date ?? ""),
      clicks: Number(metrics.clicks ?? 0),
      impressions: Number(metrics.impressions ?? 0),
      conversions: Number(metrics.conversions ?? 0),
      conversionsValue: Number(metrics.conversions_value ?? 0),
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
//
// Deliberately NOT filtered on campaign.status, same reasoning as
// pullDailyMetrics — LSA in particular rotates/replaces campaigns behind
// the scenes, so filtering to only currently-ENABLED campaigns silently
// dropped real historical cost from any campaign no longer enabled today,
// even for the exact dates it was running and spending.
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
  // Counts keyed by the lead's service_id (e.g. "auto_accidents") — the
  // same namespace campaign_criterion uses, so these cross-check directly
  // against which services were enabled that day (see lsa_service_snapshots).
  serviceIdCounts: Record<string, number>;
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
           local_services_lead.service_id, local_services_lead.category_id,
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
      serviceIdCounts: {},
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

    const serviceId = lead.service_id;
    if (typeof serviceId === "string" && serviceId) {
      bucket.serviceIdCounts[serviceId] = (bucket.serviceIdCounts[serviceId] ?? 0) + 1;
    }

    byDate.set(date, bucket);
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export type LocalServiceCriterionRow = {
  campaignId: string;
  campaignName: string;
  criterionId: string;
  serviceId: string;
  status: string;
  negative: boolean;
};

// Pulls the Local Services *service* criteria (practice areas) for an LSA
// account. Confirmed live across 34 real accounts: LSA campaigns DO expose
// criteria, resolving a conflict in Google's own docs, and
// campaign_criterion.local_service_id.service_id returns the same
// human-readable ids leads carry (e.g. "auto_accidents") — directly
// comparable, no mapping needed.
//
// Returns ONLY rows that actually carry a service id. A real account's
// criteria are dominated by geo/language rows (up to 96 of 168), so callers
// must never assume the service rows appear early in the result set — a
// 100-row cap on an earlier diagnostic made four accounts look as though
// they had zero services enabled when they had 5-14.
//
// Deliberately NOT filtered on campaign.status — that reflects CURRENT
// status, not status on any historical date, and has already caused real
// data loss twice in this codebase.
export async function pullLocalServiceCriteria(
  refreshToken: string,
  customerId: string,
  loginCustomerId: string | undefined,
): Promise<LocalServiceCriterionRow[]> {
  const customer = getCustomer(refreshToken, customerId, loginCustomerId);
  const rows = await customer.query(`
    SELECT
      campaign.id,
      campaign.name,
      campaign_criterion.criterion_id,
      campaign_criterion.status,
      campaign_criterion.negative,
      campaign_criterion.local_service_id.service_id
    FROM campaign_criterion
    WHERE campaign.advertising_channel_type = 'LOCAL_SERVICES'
  `);

  const out: LocalServiceCriterionRow[] = [];
  for (const r of rows) {
    const campaign = r.campaign ?? {};
    const criterion = (r as {
      campaign_criterion?: {
        criterion_id?: string | number | null;
        status?: string | number | null;
        negative?: boolean | null;
        local_service_id?: { service_id?: string | null } | null;
      };
    }).campaign_criterion;
    const serviceId = criterion?.local_service_id?.service_id;
    if (!serviceId) continue;
    const status =
      typeof criterion?.status === "number"
        ? enums.CampaignCriterionStatus[criterion.status]
        : String(criterion?.status ?? "");
    out.push({
      campaignId: String(campaign.id ?? ""),
      campaignName: String(campaign.name ?? ""),
      criterionId: String(criterion?.criterion_id ?? ""),
      serviceId: String(serviceId),
      status,
      negative: criterion?.negative === true,
    });
  }
  return out;
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
  // e.g. "PERFORMANCE_MAX", "SEARCH", "LOCAL_SERVICES" — added to audit
  // whether call_view ever carries a non-PMax campaign (createGmbAdMatcher
  // reclassifies ANY matched call_view row to "PMax" today, regardless of
  // what kind of campaign actually produced it — see
  // pmax-campaign-type-audit). Not yet used to gate or filter matching
  // itself; purely diagnostic until that's confirmed one way or the other.
  campaignAdvertisingChannelType: string;
};

function decodeCallTrackingDisplayLocation(raw: unknown): string {
  if (typeof raw !== "number") return String(raw ?? "");
  const enumMap = (enums as Record<string, Record<number, string> | undefined>)
    .CallTrackingDisplayLocation;
  return enumMap?.[raw] ?? String(raw);
}

// Same decode pattern as pullDailyMetrics' campaign.status handling —
// e.g. "PERFORMANCE_MAX", "SEARCH", "LOCAL_SERVICES".
function decodeAdvertisingChannelType(raw: unknown): string {
  if (typeof raw !== "number") return String(raw ?? "");
  const enumMap = (enums as Record<string, Record<number, string> | undefined>)
    .AdvertisingChannelType;
  return enumMap?.[raw] ?? String(raw);
}

// Pulls Google Ads' call_view resource — calls placed via a call
// extension/call-only ad — for cross-referencing against CallRail calls to
// determine ad-driven vs organic (see callrail.ts). Confirmed live against
// a real account: call_view rejects segments.date entirely in SELECT or
// WHERE (PROHIBITED_SEGMENT_IN_SELECT_OR_WHERE_CLAUSE) — it isn't
// date-filterable the way campaign/local_services_lead are. campaign.id/
// campaign.name/campaign.status/campaign.advertising_channel_type are
// call_view's documented "Attributed Resources" (selectable/filterable,
// but don't segment the result set), which is why only those (not
// segments.*) appear in the WHERE-less query below.
//
// Since there's no server-side date bound, we pull the most recent rows
// instead (capped + ordered) and let the caller bucket by date itself. The
// "~28 rows per account" figure from an earlier diagnostic only held with
// the campaign.status = 'ENABLED' filter still in place (see below) — once
// that filter was dropped, the same diagnostic saw one real account
// (The Weinstein Firm) hit this exact 1000-row cap, so the cap is no
// longer just a safety margin for a hypothetical future high-volume
// account; it can bind today. The warn-log right below at least surfaces
// when that happens.
//
// Deliberately NOT filtered on campaign.status — same reasoning as
// pullDailyMetrics/pullLocalServicesCost, and live-confirmed to matter here
// too: a diagnostic run (see call-view-status-filter-audit) found 1,516
// call_view rows silently dropped by this filter across 16 of 21 active
// clients (390 tied to PAUSED campaigns, 1,126 to REMOVED), including one
// client (Knoxville Car Accident Lawyers) left with zero call_view rows at
// all — every campaign it ever produced a tracked call on has since been
// paused or removed. Filtering to currently-ENABLED campaigns was dropping
// real historical PMax call-attribution data, not just a theoretical edge
// case.
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
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type
    FROM call_view
    ORDER BY call_view.start_call_date_time DESC
    LIMIT 1000
  `);

  // The LIMIT above has no detection today for when a client's call_view
  // volume actually exceeds it — a hit here means older in-window rows
  // were silently excluded from PMax matching. Purely observability, not
  // a behavior change: still returns whatever came back either way.
  if (rows.length === 1000) {
    console.warn(
      `[pullCallViewRows] hit the 1000-row cap for customerId=${customerId} — older in-window call_view rows may have been silently dropped from PMax matching`,
    );
  }

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
      campaignAdvertisingChannelType: decodeAdvertisingChannelType(
        campaign.advertising_channel_type,
      ),
    };
  });
}

// ---------------------------------------------------------------------------
// Keyword + search-term reporting (see ppc-search-terms-sync.ts)
// ---------------------------------------------------------------------------

function decodeEnum(enumName: string, raw: unknown): string {
  if (typeof raw !== "number") return String(raw ?? "");
  const enumMap = (enums as Record<string, Record<number, string> | undefined>)[enumName];
  return enumMap?.[raw] ?? String(raw);
}

export type KeywordDailyRow = {
  date: string; // YYYY-MM-DD
  campaignId: string;
  campaignName: string;
  adGroupId: string;
  adGroupName: string;
  criterionId: string;
  keywordText: string;
  matchType: string;
  clicks: number;
  impressions: number;
  costMicros: bigint;
  conversions: number;
  conversionsValue: number;
};

// Daily keyword metrics from keyword_view. metrics.conversions only (primary
// conversion actions) — never all_conversions. Deliberately NOT filtered on
// campaign/ad group/keyword status: those reflect CURRENT status, and
// filtering on them alongside segments.date drops real historical spend
// (same bug class as pullDailyMetrics).
export async function pullKeywordDaily(
  refreshToken: string,
  customerId: string,
  fromDate: string,
  toDate: string,
): Promise<KeywordDailyRow[]> {
  const customer = getCustomer(refreshToken, customerId);
  const rows = (await customer.query(`
    SELECT
      campaign.id,
      campaign.name,
      ad_group.id,
      ad_group.name,
      ad_group_criterion.criterion_id,
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      segments.date,
      metrics.clicks,
      metrics.impressions,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM keyword_view
    WHERE segments.date BETWEEN '${fromDate}' AND '${toDate}'
  `)) as Array<Record<string, Record<string, unknown> | undefined>>;

  return rows.map((r) => {
    const campaign = r.campaign ?? {};
    const adGroup = r.ad_group ?? {};
    const criterion = r.ad_group_criterion ?? {};
    const keyword = (criterion.keyword ?? {}) as Record<string, unknown>;
    const segments = r.segments ?? {};
    const metrics = r.metrics ?? {};
    return {
      date: String(segments.date ?? ""),
      campaignId: String(campaign.id ?? ""),
      campaignName: String(campaign.name ?? ""),
      adGroupId: String(adGroup.id ?? ""),
      adGroupName: String(adGroup.name ?? ""),
      criterionId: String(criterion.criterion_id ?? ""),
      keywordText: String(keyword.text ?? ""),
      matchType: decodeEnum("KeywordMatchType", keyword.match_type),
      clicks: Number(metrics.clicks ?? 0),
      impressions: Number(metrics.impressions ?? 0),
      costMicros: BigInt((metrics.cost_micros as number | string | undefined) ?? 0),
      conversions: Number(metrics.conversions ?? 0),
      conversionsValue: Number(metrics.conversions_value ?? 0),
    };
  });
}

export type SearchTermDailyRow = {
  date: string; // YYYY-MM-DD
  campaignId: string;
  campaignName: string;
  adGroupId: string;
  adGroupName: string;
  searchTerm: string;
  keywordText: string;
  keywordMatchType: string;
  searchTermMatchType: string;
  clicks: number;
  impressions: number;
  costMicros: bigint;
  conversions: number;
  conversionsValue: number;
};

// Daily search-term metrics from search_term_view (Search campaigns; it
// excludes Performance Max), limited to terms with a click that day. A live
// check across three accounts found zero rows with a conversion but no
// click, and the impression-only tail is ~97% of rows, so clicks > 0 is the
// whole storage rule.
//
// Two queries, because the keyword segments DROP any term that no keyword
// triggered (live: one account lost 52 of 245 clicks that way). The second
// query has no keyword segments, so it carries every term; whatever it has
// beyond the first query's per-term sum is the no-keyword remainder, which
// is returned as its own row with an empty keyword. See
// deriveKeywordlessRows.
//
// Same rules as pullKeywordDaily: metrics.conversions only, no status
// filter of any kind.
export async function pullSearchTermDaily(
  refreshToken: string,
  customerId: string,
  fromDate: string,
  toDate: string,
): Promise<SearchTermDailyRow[]> {
  const customer = getCustomer(refreshToken, customerId);
  const metricsAndFrom = `
      segments.date,
      metrics.clicks,
      metrics.impressions,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM search_term_view
    WHERE segments.date BETWEEN '${fromDate}' AND '${toDate}'
      AND metrics.clicks > 0
  `;
  const dims = `
      campaign.id,
      campaign.name,
      ad_group.id,
      ad_group.name,
      search_term_view.search_term,`;
  type Raw = Array<Record<string, Record<string, unknown> | undefined>>;
  const [withKeyword, allTerms] = (await Promise.all([
    customer.query(`
    SELECT${dims}
      segments.keyword.info.text,
      segments.keyword.info.match_type,
      segments.search_term_match_type,${metricsAndFrom}`),
    customer.query(`
    SELECT${dims}${metricsAndFrom}`),
  ])) as [Raw, Raw];

  const toRow = (r: Raw[number]): SearchTermDailyRow => {
    const campaign = r.campaign ?? {};
    const adGroup = r.ad_group ?? {};
    const view = r.search_term_view ?? {};
    const segments = r.segments ?? {};
    const keywordInfo = (((segments.keyword ?? {}) as Record<string, unknown>).info ??
      {}) as Record<string, unknown>;
    const metrics = r.metrics ?? {};
    return {
      date: String(segments.date ?? ""),
      campaignId: String(campaign.id ?? ""),
      campaignName: String(campaign.name ?? ""),
      adGroupId: String(adGroup.id ?? ""),
      adGroupName: String(adGroup.name ?? ""),
      searchTerm: String(view.search_term ?? ""),
      keywordText: String(keywordInfo.text ?? ""),
      keywordMatchType:
        keywordInfo.match_type == null
          ? ""
          : decodeEnum("KeywordMatchType", keywordInfo.match_type),
      searchTermMatchType:
        segments.search_term_match_type == null
          ? ""
          : decodeEnum("SearchTermMatchType", segments.search_term_match_type),
      clicks: Number(metrics.clicks ?? 0),
      impressions: Number(metrics.impressions ?? 0),
      costMicros: BigInt((metrics.cost_micros as number | string | undefined) ?? 0),
      conversions: Number(metrics.conversions ?? 0),
      conversionsValue: Number(metrics.conversions_value ?? 0),
    };
  };

  const keyworded = withKeyword.map(toRow);
  return [...keyworded, ...deriveKeywordlessRows(keyworded, allTerms.map(toRow))];
}

// `allTerms` (no keyword segments) minus the per-term sum of `keyworded`
// leaves the traffic no keyword triggered. Compared per date + ad group +
// search term. A remainder only becomes a row when it still has a click;
// metrics are floored at zero so rounding in fractional conversions can
// never produce a negative.
export function deriveKeywordlessRows(
  keyworded: SearchTermDailyRow[],
  allTerms: SearchTermDailyRow[],
): SearchTermDailyRow[] {
  const keyOf = (r: SearchTermDailyRow) => [r.date, r.adGroupId, r.searchTerm].join("\u0000");
  const used = new Map<
    string,
    { clicks: number; impressions: number; costMicros: bigint; conversions: number; conversionsValue: number }
  >();
  for (const r of keyworded) {
    const u = used.get(keyOf(r)) ?? {
      clicks: 0,
      impressions: 0,
      costMicros: 0n,
      conversions: 0,
      conversionsValue: 0,
    };
    u.clicks += r.clicks;
    u.impressions += r.impressions;
    u.costMicros += r.costMicros;
    u.conversions += r.conversions;
    u.conversionsValue += r.conversionsValue;
    used.set(keyOf(r), u);
  }
  const out: SearchTermDailyRow[] = [];
  for (const r of allTerms) {
    const u = used.get(keyOf(r));
    const clicks = r.clicks - (u?.clicks ?? 0);
    if (clicks <= 0) continue;
    const cost = r.costMicros - (u?.costMicros ?? 0n);
    out.push({
      ...r,
      keywordText: "",
      keywordMatchType: "",
      searchTermMatchType: "",
      clicks,
      impressions: Math.max(0, r.impressions - (u?.impressions ?? 0)),
      costMicros: cost > 0n ? cost : 0n,
      conversions: Math.max(0, r.conversions - (u?.conversions ?? 0)),
      conversionsValue: Math.max(0, r.conversionsValue - (u?.conversionsValue ?? 0)),
    });
  }
  return out;
}

export type SearchCampaignDailyRow = {
  date: string; // YYYY-MM-DD
  campaignId: string;
  campaignName: string;
  clicks: number;
  impressions: number;
  costMicros: bigint;
  conversions: number;
  conversionsValue: number;
};

// Daily totals for SEARCH campaigns only — the reference the search-term
// and keyword reports reconcile against (their two gap rows). Filtering on
// advertising_channel_type is safe alongside a date range: a campaign's
// type never changes. Still no status filter.
export async function pullSearchCampaignDaily(
  refreshToken: string,
  customerId: string,
  fromDate: string,
  toDate: string,
): Promise<SearchCampaignDailyRow[]> {
  const customer = getCustomer(refreshToken, customerId);
  const rows = (await customer.query(`
    SELECT
      campaign.id,
      campaign.name,
      segments.date,
      metrics.clicks,
      metrics.impressions,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM campaign
    WHERE campaign.advertising_channel_type = 'SEARCH'
      AND segments.date BETWEEN '${fromDate}' AND '${toDate}'
  `)) as Array<Record<string, Record<string, unknown> | undefined>>;
  return rows.map((r) => {
    const campaign = r.campaign ?? {};
    const metrics = r.metrics ?? {};
    return {
      date: String(r.segments?.date ?? ""),
      campaignId: String(campaign.id ?? ""),
      campaignName: String(campaign.name ?? ""),
      clicks: Number(metrics.clicks ?? 0),
      impressions: Number(metrics.impressions ?? 0),
      costMicros: BigInt((metrics.cost_micros as number | string | undefined) ?? 0),
      conversions: Number(metrics.conversions ?? 0),
      conversionsValue: Number(metrics.conversions_value ?? 0),
    };
  });
}

// ---------------------------------------------------------------------------
// Account health (see ppc-account-health-sync.ts)
// ---------------------------------------------------------------------------

export type AccountHealthPull = {
  budgetCampaigns: BudgetCampaignRow[];
  mtdSpendMicros: bigint;
  // Spend on `toDate` alone — one day's spend to set against the budget in
  // force that day.
  daySpendMicros: bigint;
  // Account-level search impression share, straight FROM customer. Each is
  // null when Google returned nothing for it.
  impressionShare: number | null;
  budgetLostShare: number | null;
  rankLostShare: number | null;
  optimizationScore: number | null;
  // Optional parts that failed, keyed by part. Budgets and spend are not
  // optional: if either fails the whole pull throws.
  errors: Record<string, string>;
};

function healthError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  const messages = (err as { errors?: Array<{ message?: string }> } | null)?.errors
    ?.map((e) => e.message)
    .filter(Boolean);
  if (messages && messages.length > 0) return messages.join(" · ");
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// One account's health inputs for a month-to-date window.
//
// - Budgets: every campaign with its budget. No date range, so reading the
//   CURRENT status is correct here (a budget only constrains campaigns that
//   are running now); the roll-up in ads-account-health.ts keeps ENABLED
//   campaigns and counts a shared budget once (live-confirmed: 290 against a
//   naive 440 on an account sharing a 150 budget).
// - Spend: all campaign types, and — because it spans dates — no status
//   filter, per the standing rule.
// - Impression share: account level (FROM customer). budget-lost and
//   rank-lost are live-confirmed there; top/absolute-top are rejected at
//   this level and not requested. One query per metric, so a rejection of
//   one can never take the others down with it.
// - Optimization score: customer.optimization_score, live-confirmed.
export async function pullAccountHealth(
  refreshToken: string,
  customerId: string,
  monthStart: string,
  toDate: string,
): Promise<AccountHealthPull> {
  const customer = getCustomer(refreshToken, customerId);
  type Row = Record<string, Record<string, unknown> | undefined>;
  const q = (gaql: string) => customer.query(gaql) as Promise<Row[]>;
  const dateWhere = `segments.date BETWEEN '${monthStart}' AND '${toDate}'`;
  const errors: Record<string, string> = {};
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const share = async (part: string, field: string): Promise<number | null> => {
    try {
      const rows = await q(`SELECT customer.id, metrics.${field} FROM customer WHERE ${dateWhere}`);
      return num(rows[0]?.metrics?.[field]);
    } catch (err) {
      errors[part] = healthError(err);
      return null;
    }
  };
  const score = async (): Promise<number | null> => {
    try {
      const rows = await q(`SELECT customer.id, customer.optimization_score FROM customer`);
      return num(rows[0]?.customer?.optimization_score);
    } catch (err) {
      errors.optimizationScore = healthError(err);
      return null;
    }
  };

  const [budgetRows, spendRows, impressionShare, budgetLostShare, rankLostShare, optimizationScore] =
    await Promise.all([
      q(`
        SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
               campaign_budget.id, campaign_budget.amount_micros, campaign_budget.period,
               campaign_budget.explicitly_shared
        FROM campaign`),
      q(`SELECT campaign.id, segments.date, metrics.cost_micros FROM campaign WHERE ${dateWhere}`),
      share("impressionShare", "search_impression_share"),
      share("budgetLostShare", "search_budget_lost_impression_share"),
      share("rankLostShare", "search_rank_lost_impression_share"),
      score(),
    ]);

  let mtdSpendMicros = BigInt(0);
  let daySpendMicros = BigInt(0);
  for (const r of spendRows) {
    const cost = BigInt((r.metrics?.cost_micros as number | string | undefined) ?? 0);
    mtdSpendMicros += cost;
    if (String(r.segments?.date ?? "") === toDate) daySpendMicros += cost;
  }
  return {
    budgetCampaigns: budgetRows.map((r) => ({
      campaignId: String(r.campaign?.id ?? ""),
      campaignName: String(r.campaign?.name ?? ""),
      status: decodeEnum("CampaignStatus", r.campaign?.status),
      channel: decodeEnum("AdvertisingChannelType", r.campaign?.advertising_channel_type),
      budgetId: String(r.campaign_budget?.id ?? ""),
      amountMicros:
        r.campaign_budget?.amount_micros === null || r.campaign_budget?.amount_micros === undefined
          ? null
          : Number(r.campaign_budget.amount_micros),
      period: decodeEnum("BudgetPeriod", r.campaign_budget?.period),
      explicitlyShared:
        typeof r.campaign_budget?.explicitly_shared === "boolean"
          ? r.campaign_budget.explicitly_shared
          : null,
    })),
    mtdSpendMicros,
    daySpendMicros,
    impressionShare,
    budgetLostShare,
    rankLostShare,
    optimizationScore,
    errors,
  };
}
