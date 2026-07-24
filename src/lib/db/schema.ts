import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  index,
} from "drizzle-orm/pg-core";

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("clients_status_idx").on(t.status),
  }),
);

export const oauthCredentials = pgTable("oauth_credentials", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  provider: text("provider").notNull(),
  accountEmail: text("account_email").notNull(),
  accessTokenEncrypted: text("access_token_encrypted").notNull(),
  refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    address: text("address").notNull(),
    placeId: text("place_id").notNull(),
    lat: numeric("lat", { precision: 10, scale: 7 }).notNull(),
    lng: numeric("lng", { precision: 10, scale: 7 }).notNull(),
    gbpAccountId: text("gbp_account_id"),
    gbpLocationId: text("gbp_location_id"),
    gbpOauthTokenId: uuid("gbp_oauth_token_id").references(() => oauthCredentials.id),
    pollFrequency: text("poll_frequency").notNull().default("daily"),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    nextPollAfter: timestamp("next_poll_after", { withTimezone: true }),
    lastPollError: text("last_poll_error"),
    lastPollErrorAt: timestamp("last_poll_error_at", { withTimezone: true }),
    consecutivePollFailures: integer("consecutive_poll_failures").notNull().default(0),
    status: text("status").notNull().default("active"),
    placeWebsiteUri: text("place_website_uri"),
    placeRating: numeric("place_rating", { precision: 2, scale: 1 }),
    placeReviewCount: integer("place_review_count"),
    placeGoogleMapsUri: text("place_google_maps_uri"),
    placeRefreshedAt: timestamp("place_refreshed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    clientIdx: index("locations_client_idx").on(t.clientId),
    placeIdx: index("locations_place_idx").on(t.placeId),
    pollIdx: index("locations_poll_idx").on(t.lastPolledAt, t.status),
  }),
);

export const keywords = pgTable(
  "keywords",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    keyword: text("keyword").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    locationIdx: index("keywords_location_idx").on(t.locationId),
    uniqPerLocation: unique("keywords_unique_per_location").on(t.locationId, t.keyword),
  }),
);

export const gridConfigs = pgTable(
  "grid_configs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    size: integer("size").notNull(),
    radiusMiles: numeric("radius_miles", { precision: 6, scale: 2 }).notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    locationIdx: index("grid_configs_location_idx").on(t.locationId),
  }),
);

export const scans = pgTable(
  "scans",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    gridConfigId: uuid("grid_config_id")
      .notNull()
      .references(() => gridConfigs.id),
    triggeredBy: text("triggered_by").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    status: text("status").notNull().default("queued"),
    errorDetail: text("error_detail"),
    totalPoints: integer("total_points").notNull().default(0),
    totalKeywords: integer("total_keywords").notNull().default(0),
    costEstimate: numeric("cost_estimate", { precision: 10, scale: 4 }),
  },
  (t) => ({
    locationIdx: index("scans_location_idx").on(t.locationId),
    statusIdx: index("scans_status_idx").on(t.status),
    startedIdx: index("scans_started_idx").on(t.startedAt),
  }),
);

export const scanPoints = pgTable(
  "scan_points",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    keywordId: uuid("keyword_id")
      .notNull()
      .references(() => keywords.id, { onDelete: "cascade" }),
    gridX: integer("grid_x").notNull(),
    gridY: integer("grid_y").notNull(),
    lat: numeric("lat", { precision: 10, scale: 7 }).notNull(),
    lng: numeric("lng", { precision: 10, scale: 7 }).notNull(),
    rank: integer("rank"),
    competitorsJson: jsonb("competitors_json"),
    rawResponseRef: text("raw_response_ref"),
    status: text("status").notNull().default("pending"),
    erroredAt: timestamp("errored_at", { withTimezone: true }),
    errorDetail: text("error_detail"),
  },
  (t) => ({
    scanIdx: index("scan_points_scan_idx").on(t.scanId),
    keywordIdx: index("scan_points_keyword_idx").on(t.keywordId),
    uniq: unique("scan_points_unique").on(t.scanId, t.keywordId, t.gridX, t.gridY),
  }),
);

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    gbpReviewId: text("gbp_review_id").notNull().unique(),
    rating: integer("rating").notNull(),
    text: text("text"),
    reviewerName: text("reviewer_name"),
    reviewerPhotoUrl: text("reviewer_photo_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
    replyText: text("reply_text"),
    replyStatus: text("reply_status"),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
  },
  (t) => ({
    locationIdx: index("reviews_location_idx").on(t.locationId),
    createdIdx: index("reviews_created_idx").on(t.createdAt),
    ratingIdx: index("reviews_rating_idx").on(t.rating),
  }),
);

export const locationPerformanceDaily = pgTable(
  "location_performance_daily",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    metricDate: date("metric_date").notNull(),
    metric: text("metric").notNull(),
    value: integer("value").notNull().default(0),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique("location_performance_daily_unique").on(
      t.locationId,
      t.metricDate,
      t.metric,
    ),
    locDateIdx: index("location_performance_daily_loc_date_idx").on(
      t.locationId,
      t.metricDate,
    ),
    metricIdx: index("location_performance_daily_metric_idx").on(t.metric),
  }),
);

export const locationDailyMetrics = pgTable(
  "location_daily_metrics",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    metricDate: date("metric_date").notNull(),
    rating: numeric("rating", { precision: 2, scale: 1 }),
    reviewCount: integer("review_count").notNull().default(0),
    reviewsLast30d: integer("reviews_last_30d").notNull().default(0),
    reviewsLast90d: integer("reviews_last_90d").notNull().default(0),
    daysSinceLastReview: integer("days_since_last_review"),
  },
  (t) => ({
    uniq: unique("location_daily_metrics_unique").on(t.locationId, t.metricDate),
    locationDateIdx: index("location_daily_metrics_loc_date_idx").on(
      t.locationId,
      t.metricDate,
    ),
  }),
);

export const trackedKeywords = pgTable(
  "tracked_keywords",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    keyword: text("keyword").notNull(),
    targetUrl: text("target_url").notNull(),
    geoCity: text("geo_city"),
    geoLocationCode: integer("geo_location_code"),
    geoLat: numeric("geo_lat", { precision: 10, scale: 7 }),
    geoLng: numeric("geo_lng", { precision: 10, scale: 7 }),
    geoFormatted: text("geo_formatted"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    clientActiveIdx: index("tracked_keywords_client_active_idx").on(t.clientId, t.isActive),
    uniqPerClient: unique("tracked_keywords_unique_per_client").on(
      t.clientId,
      t.keyword,
      t.geoCity,
    ),
  }),
);

export const serpRankings = pgTable(
  "serp_rankings",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    trackedKeywordId: uuid("tracked_keyword_id")
      .notNull()
      .references(() => trackedKeywords.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    keyword: text("keyword").notNull(),
    targetUrl: text("target_url").notNull(),
    nationalRank: integer("national_rank"),
    nationalUrl: text("national_url"),
    geoRank: integer("geo_rank"),
    geoUrl: text("geo_url"),
    geoBareRank: integer("geo_bare_rank"),
    geoBareUrl: text("geo_bare_url"),
    geoCity: text("geo_city"),
    geoLocationCode: integer("geo_location_code"),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    trackedCheckedIdx: index("serp_rankings_tracked_checked_idx").on(
      t.trackedKeywordId,
      t.checkedAt,
    ),
    clientCheckedIdx: index("serp_rankings_client_checked_idx").on(t.clientId, t.checkedAt),
  }),
);

export const serpScanJobs = pgTable("serp_scan_jobs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  status: text("status").notNull(),
  clientIds: uuid("client_ids").array(),
  totalKeywords: integer("total_keywords").notNull().default(0),
  completedKeywords: integer("completed_keywords").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  triggeredBy: text("triggered_by").notNull().default("scheduled"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// PPC reporting (Google Ads + CallRail)
// ---------------------------------------------------------------------------

export const ppcClients = pgTable(
  "ppc_clients",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    isActive: boolean("is_active").notNull().default(true),
    // Set after the OAuth flow completes. Distinct from the OAuth token id
    // (which lives in oauth_credentials) because one Google account can
    // manage many Google Ads customer ids and the user picks one to bind.
    googleAdsCustomerId: text("google_ads_customer_id"),
    googleAdsOauthTokenId: uuid("google_ads_oauth_token_id").references(
      () => oauthCredentials.id,
      { onDelete: "set null" },
    ),
    // Cached output of listAccessibleCustomers + descriptive-name lookup,
    // populated on connect/attach/refresh. Powers the customer-id dropdown
    // in the admin UI so the operator picks rather than types digits.
    // Shape: Array<{ id: string; name: string | null }>.
    googleAdsDiscoveredCustomersJson: jsonb("google_ads_discovered_customers_json"),
    callrailCompanyId: text("callrail_company_id"),
    signedCaseTag: text("signed_case_tag").notNull().default("Signed"),
    // Per-client substring filters applied to the CallRail tracking number's
    // name. A call counts as a signed case only if it carries the tag above
    // AND its tracker name contains one of these substrings (case-insensitive).
    // Empty array = no name filter (tag-only behavior).
    signedCaseNameFilters: text("signed_case_name_filters")
      .array()
      .notNull()
      .default(sql`ARRAY['PPC', 'Ads', 'GMB']::text[]`),
    // Channel split for the Ads Conversion Tracker x CallRail report only —
    // independent of signedCaseNameFilters above, which stays untouched. A
    // call whose tracker/source name contains one of these substrings is
    // reported as channel "GMB"; every other call under this client's
    // CallRail company is reported as channel "PPC". Empty array = every
    // call classified as PPC (no GMB split configured yet).
    gmbCallrailNameFilters: text("gmb_callrail_name_filters")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    lastAdsSyncAt: timestamp("last_ads_sync_at", { withTimezone: true }),
    lastCallrailSyncAt: timestamp("last_callrail_sync_at", { withTimezone: true }),
    lastSyncError: text("last_sync_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activeIdx: index("ppc_clients_active_idx").on(t.isActive),
  }),
);

export const ppcCampaigns = pgTable(
  "ppc_campaigns",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    ppcClientId: uuid("ppc_client_id")
      .notNull()
      .references(() => ppcClients.id, { onDelete: "cascade" }),
    googleAdsCampaignId: text("google_ads_campaign_id").notNull(),
    name: text("name").notNull(),
    status: text("status"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique("ppc_campaigns_unique").on(t.ppcClientId, t.googleAdsCampaignId),
    clientIdx: index("ppc_campaigns_client_idx").on(t.ppcClientId),
  }),
);

export const ppcAdsDaily = pgTable(
  "ppc_ads_daily",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    ppcClientId: uuid("ppc_client_id")
      .notNull()
      .references(() => ppcClients.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => ppcCampaigns.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    clicks: integer("clicks").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    // Google Ads supports fractional conversions (counting rules, etc).
    conversions: numeric("conversions", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    // Google Ads stores cost in micros (1/1,000,000 of currency unit). Bigint
    // keeps us safe past a $9k/day per-campaign threshold.
    costMicros: bigint("cost_micros", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    phoneCalls: integer("phone_calls").notNull().default(0),
    ingestedAt: timestamp("ingested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniq: unique("ppc_ads_daily_unique").on(t.campaignId, t.date),
    clientDateIdx: index("ppc_ads_daily_client_date_idx").on(
      t.ppcClientId,
      t.date,
    ),
  }),
);

export const ppcCallrailDaily = pgTable(
  "ppc_callrail_daily",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    ppcClientId: uuid("ppc_client_id")
      .notNull()
      .references(() => ppcClients.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    totalCalls: integer("total_calls").notNull().default(0),
    signedCases: integer("signed_cases").notNull().default(0),
    // Per-day counts keyed by this client's configured tag category label
    // (ppc_callrail_tag_categories), e.g. { "Signed": 3, "Spam": 1 }. Powers
    // the Ads Conversion Tracker x CallRail report. jsonb rather than fixed
    // columns since categories are freely editable per client.
    tagCategoryBreakdown: jsonb("tag_category_breakdown")
      .notNull()
      .default(sql`'{}'::jsonb`),
    ingestedAt: timestamp("ingested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniq: unique("ppc_callrail_daily_unique").on(t.ppcClientId, t.date),
  }),
);

export const ppcSyncJobs = pgTable("ppc_sync_jobs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  // Null for "sync all" cron runs; populated for per-client "sync now".
  ppcClientId: uuid("ppc_client_id").references(() => ppcClients.id, {
    onDelete: "cascade",
  }),
  kind: text("kind").notNull(), // 'google_ads' | 'callrail'
  status: text("status").notNull(), // 'pending' | 'running' | 'completed' | 'failed'
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  triggeredBy: text("triggered_by").notNull().default("scheduled"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Client = typeof clients.$inferSelect;
export type Location = typeof locations.$inferSelect;
export type Keyword = typeof keywords.$inferSelect;
export type GridConfig = typeof gridConfigs.$inferSelect;
export type Scan = typeof scans.$inferSelect;
export type ScanPoint = typeof scanPoints.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type LocationDailyMetric = typeof locationDailyMetrics.$inferSelect;
export type LocationPerformanceDaily = typeof locationPerformanceDaily.$inferSelect;
export type OauthCredential = typeof oauthCredentials.$inferSelect;
export type TrackedKeyword = typeof trackedKeywords.$inferSelect;
export type SerpRanking = typeof serpRankings.$inferSelect;
export type SerpScanJob = typeof serpScanJobs.$inferSelect;
export type PpcClient = typeof ppcClients.$inferSelect;
export type PpcCampaign = typeof ppcCampaigns.$inferSelect;
export type PpcAdsDaily = typeof ppcAdsDaily.$inferSelect;
export type PpcCallrailDaily = typeof ppcCallrailDaily.$inferSelect;
export type PpcSyncJob = typeof ppcSyncJobs.$inferSelect;

// Editable per-client tag categories for the Ads Conversion Tracker x
// CallRail report — team can add/edit/remove these without a code change.
// No uniqueness constraint on (ppcClientId, callrailTagName): a client may
// freely rename or duplicate a category from the admin UI.
export const ppcCallrailTagCategories = pgTable(
  "ppc_callrail_tag_categories",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    ppcClientId: uuid("ppc_client_id")
      .notNull()
      .references(() => ppcClients.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    // The literal CallRail tag name to match against a call's tags[].
    callrailTagName: text("callrail_tag_name").notNull(),
    rollup: text("rollup").notNull(), // "real" | "junk"
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    clientIdx: index("ppc_callrail_tag_categories_client_idx").on(
      t.ppcClientId,
    ),
  }),
);

export type PpcCallrailTagCategory =
  typeof ppcCallrailTagCategories.$inferSelect;

export const ppcReportRecipients = pgTable("ppc_report_recipients", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PpcReportRecipient = typeof ppcReportRecipients.$inferSelect;

// Separate distribution list from ppcReportRecipients — the daily PPC PDF
// report is exec-facing, while the optimization score alert is ads-team
// facing, so the two lists don't have to be the same people.
export const ppcOptimizationAlertRecipients = pgTable(
  "ppc_optimization_alert_recipients",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    email: text("email").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export type PpcOptimizationAlertRecipient =
  typeof ppcOptimizationAlertRecipients.$inferSelect;

// ---------------------------------------------------------------------------
// LSA reporting (Local Services Ads leads + Google Ads cost + CallRail)
// ---------------------------------------------------------------------------

export const lsaClients = pgTable(
  "lsa_clients",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    isActive: boolean("is_active").notNull().default(true),
    googleAdsCustomerId: text("google_ads_customer_id"),
    googleAdsOauthTokenId: uuid("google_ads_oauth_token_id").references(
      () => oauthCredentials.id,
      { onDelete: "set null" },
    ),
    // Per-client login-customer-id override. LSA MCCs are separate accounts
    // from PPC's MCC, so the single global GOOGLE_ADS_LOGIN_CUSTOMER_ID env
    // var PPC relies on isn't sufficient here — each LSA client's Google
    // Ads customer sits under its own manager account.
    loginCustomerId: text("login_customer_id"),
    googleAdsDiscoveredCustomersJson: jsonb("google_ads_discovered_customers_json"),
    callrailCompanyId: text("callrail_company_id"),
    signedCaseTag: text("signed_case_tag").notNull().default("Signed"),
    // Same mechanism as ppc_clients.signed_case_name_filters, defaulted to
    // the LSA tracking-number naming convention instead of PPC's.
    signedCaseNameFilters: text("signed_case_name_filters")
      .array()
      .notNull()
      .default(sql`ARRAY['LSA']::text[]`),
    lastAdsSyncAt: timestamp("last_ads_sync_at", { withTimezone: true }),
    lastCallrailSyncAt: timestamp("last_callrail_sync_at", { withTimezone: true }),
    lastSyncError: text("last_sync_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activeIdx: index("lsa_clients_active_idx").on(t.isActive),
  }),
);

export type LsaClient = typeof lsaClients.$inferSelect;

// One row per (lsa_client, date), merging leads + cost + CallRail in a
// single write from the sync itself — unlike the PPC tables (ppc_ads_daily /
// ppc_campaigns / ppc_callrail_daily), which are joined at report-query
// time and can silently drop a client that has CallRail data but no Ads
// activity in the window. Folding all three sources into one row here
// avoids that failure mode entirely: the report reads one table, no join.
export const lsaLeadsDaily = pgTable(
  "lsa_leads_daily",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    lsaClientId: uuid("lsa_client_id")
      .notNull()
      .references(() => lsaClients.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    phoneCallCount: integer("phone_call_count").notNull().default(0),
    messageCount: integer("message_count").notNull().default(0),
    bookingCount: integer("booking_count").notNull().default(0),
    // Leads Google actually charged for that day, per local_services_lead's
    // lead_charged field — distinct from lead_status, since a lead can be
    // credited/refunded by Google after the fact. Captured for future
    // cost-reconciliation; not yet subtracted from cost_micros anywhere.
    chargedCount: integer("charged_count").notNull().default(0),
    // Counts per LocalServicesLeadStatus name (NEW, ACTIVE, BOOKED,
    // DECLINED, EXPIRED, DISABLED, CONSUMER_DECLINED, WIPED_OUT). jsonb
    // rather than one column per status — the set is wide and this is
    // supplementary detail, not something the report's KPIs are driven by.
    leadStatusBreakdown: jsonb("lead_status_breakdown")
      .notNull()
      .default(sql`'{}'::jsonb`),
    costMicros: bigint("cost_micros", { mode: "bigint" }).notNull().default(sql`0`),
    signedCases: integer("signed_cases").notNull().default(0),
    // Per-day counts keyed by this client's configured tag category label
    // (lsa_callrail_tag_categories) — same purpose as ppc_callrail_daily's
    // column of the same name, for the Ads Conversion Tracker x CallRail
    // report.
    tagCategoryBreakdown: jsonb("tag_category_breakdown")
      .notNull()
      .default(sql`'{}'::jsonb`),
    // CallRail's first_call flag, counted per day — same field
    // pullCallsForCompany already returns for PPC (nested inside
    // tag_category_breakdown's channel split there); LSA has no channel
    // split, so it gets its own plain column, same as every other numeric
    // metric on this table.
    firstTimeCalls: integer("first_time_calls").notNull().default(0),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique("lsa_leads_daily_unique").on(t.lsaClientId, t.date),
    clientDateIdx: index("lsa_leads_daily_client_date_idx").on(t.lsaClientId, t.date),
  }),
);

export type LsaLeadsDaily = typeof lsaLeadsDaily.$inferSelect;

// Mirrors ppcCallrailTagCategories — see its comment for the rationale.
export const lsaCallrailTagCategories = pgTable(
  "lsa_callrail_tag_categories",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    lsaClientId: uuid("lsa_client_id")
      .notNull()
      .references(() => lsaClients.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    callrailTagName: text("callrail_tag_name").notNull(),
    rollup: text("rollup").notNull(), // "real" | "junk"
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    clientIdx: index("lsa_callrail_tag_categories_client_idx").on(
      t.lsaClientId,
    ),
  }),
);

export type LsaCallrailTagCategory =
  typeof lsaCallrailTagCategories.$inferSelect;

export const lsaSyncJobs = pgTable("lsa_sync_jobs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  // Null for "sync all" cron runs; populated for per-client "sync now".
  lsaClientId: uuid("lsa_client_id").references(() => lsaClients.id, {
    onDelete: "cascade",
  }),
  kind: text("kind").notNull(), // 'google_ads' | 'callrail'
  status: text("status").notNull(), // 'pending' | 'running' | 'completed' | 'failed'
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  triggeredBy: text("triggered_by").notNull().default("scheduled"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type LsaSyncJob = typeof lsaSyncJobs.$inferSelect;

export const lsaReportRecipients = pgTable("lsa_report_recipients", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type LsaReportRecipient = typeof lsaReportRecipients.$inferSelect;

// Daily-ish snapshot of DataForSEO's lifetime spend (computed as
// money.total - money.balance). Used by the sidebar's "SEO API spend"
// indicator to derive a month-to-date number from a baseline taken
// before the first of the current month. Written lazily on every cache
// miss of the indicator API.
export const dataforseoSpendSnapshots = pgTable("dataforseo_spend_snapshots", {
  date: date("date").primaryKey(),
  lifetimeSpentUsd: numeric("lifetime_spent_usd").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type DataforseoSpendSnapshot =
  typeof dataforseoSpendSnapshots.$inferSelect;
