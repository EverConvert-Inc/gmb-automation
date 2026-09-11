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
    // Takedown detection: lastSeenAt is touched every poll GBP still returns
    // this review. missingSinceAt is set the first poll it's absent from a
    // full sweep and cleared if it reappears — so "missing continuously for
    // over the confirmation window" is just missingSinceAt's age, no
    // separate consecutive-miss counter needed. See src/lib/reviews.ts.
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    missingSinceAt: timestamp("missing_since_at", { withTimezone: true }),
  },
  (t) => ({
    locationIdx: index("reviews_location_idx").on(t.locationId),
    createdIdx: index("reviews_created_idx").on(t.createdAt),
    ratingIdx: index("reviews_rating_idx").on(t.rating),
    missingIdx: index("reviews_missing_idx").on(t.missingSinceAt),
  }),
);

export const reviewTakedownAlerts = pgTable(
  "review_takedown_alerts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    // Snapshot of the review at confirmation time, so the reinstatement
    // request has everything it needs even if the `reviews` row is ever
    // pruned later. Google's UI shows nothing for this review by the time
    // this fires — this snapshot is the only remaining record of it.
    rating: integer("rating").notNull(),
    text: text("text"),
    reviewerName: text("reviewer_name"),
    reviewCreatedAt: timestamp("review_created_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    detectedMissingAt: timestamp("detected_missing_at", { withTimezone: true }).notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull().default("confirmed"),
    slackAlertedAt: timestamp("slack_alerted_at", { withTimezone: true }),
    emailAlertedAt: timestamp("email_alerted_at", { withTimezone: true }),
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqPerReview: unique("review_takedown_alerts_review_unique").on(t.reviewId),
    locationIdx: index("review_takedown_alerts_location_idx").on(t.locationId),
    clientIdx: index("review_takedown_alerts_client_idx").on(t.clientId),
    statusIdx: index("review_takedown_alerts_status_idx").on(t.status),
    confirmedIdx: index("review_takedown_alerts_confirmed_idx").on(t.confirmedAt),
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
    // columns since categories are freely editable per client. A call can
    // land in multiple labels here if it carries multiple matching tags —
    // this is a per-label breakdown, not a per-call rollup (see
    // rollup_breakdown below for that).
    tagCategoryBreakdown: jsonb("tag_category_breakdown")
      .notNull()
      .default(sql`'{}'::jsonb`),
    // Per-day, per-call real/junk/unclassified counts — computed at sync
    // time (callrail.ts), capped at 1 per call per rollup (Junk > Real >
    // Unclassified priority when a call has tags mapping to more than one
    // rollup), unlike tagCategoryBreakdown above which double-counts a
    // call across every matching label. Channel-nested: { "PPC": {real,
    // junk, unclassified}, "GMB": {...} }.
    rollupBreakdown: jsonb("rollup_breakdown")
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
export type ReviewTakedownAlert = typeof reviewTakedownAlerts.$inferSelect;
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
    // Same mechanism as ppc_clients.gmb_callrail_name_filters — channel
    // split for the Ads Conversion Tracker x CallRail report only,
    // independent of signedCaseNameFilters above. Only actually applied at
    // sync time when this LSA client's CallRail company has no matching
    // ppc_clients row (see lsa-sync.ts) — when a PPC counterpart shares the
    // same company, GMB classification stays owned by the PPC side to
    // avoid double-counting the same calls under both channels.
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
    // report. Per-label, not per-call — see rollup_breakdown below. Flat
    // (today's shape, and forever for a client whose CallRail company has
    // a matching ppc_clients row — GMB stays owned by that side) or
    // channel-nested (keyed "LSA"/"GMB", for an LSA-only client with
    // gmb_callrail_name_filters configured — see lsa-sync.ts).
    tagCategoryBreakdown: jsonb("tag_category_breakdown")
      .notNull()
      .default(sql`'{}'::jsonb`),
    // Per-day, per-call real/junk/unclassified counts — same purpose as
    // ppc_callrail_daily's column of the same name. Same flat-or-nested
    // duality as tag_category_breakdown above.
    rollupBreakdown: jsonb("rollup_breakdown")
      .notNull()
      .default(sql`'{}'::jsonb`),
    // CallRail's first_call flag, counted per day — same field
    // pullCallsForCompany already returns for PPC (nested inside
    // tag_category_breakdown's channel split there). jsonb rather than a
    // plain integer for the same reason as tag_category_breakdown/
    // rollup_breakdown above: a flat JSON number (today's shape, and
    // forever for a shared-company client) or a channel-nested object
    // (keyed "LSA"/"GMB", for an LSA-only client with its own GMB split).
    firstTimeCalls: jsonb("first_time_calls").notNull().default(sql`'0'::jsonb`),
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

// Separate distribution list from ppcReportRecipients/lsaReportRecipients —
// the cross-channel Call Quality PDF report has its own audience, same
// pattern as those two.
export const callQualityReportRecipients = pgTable(
  "call_quality_report_recipients",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    email: text("email").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export type CallQualityReportRecipient =
  typeof callQualityReportRecipients.$inferSelect;

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

// --- "True sign date" tracking (additive-only; does not feed any existing
// report) ---
//
// Mutable diffing baseline for the text-message polling approach to
// approximating a lead's true sign moment (see textConversationSignedEvents
// below) — one row per (lsa_client, conversation), storing only the LAST
// rollup observed for that conversation on the most recent sync run, purely
// so the next run can tell whether anything changed. Never read by any
// report — this table exists only to support the transition-detection
// diff in lsa-sync.ts, and is fully separate from lsa_leads_daily's
// rollup_breakdown (which pullTextMessagesForCompany's existing dailyRollups
// output continues to feed unchanged).
export const lsaTextConversationTagState = pgTable(
  "lsa_text_conversation_tag_state",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    lsaClientId: uuid("lsa_client_id")
      .notNull()
      .references(() => lsaClients.id, { onDelete: "cascade" }),
    callrailConversationId: text("callrail_conversation_id").notNull(),
    // "real" | "junk" | "unclassified" — see resolveCallRollup in
    // callrail.ts. Stored as plain text, same convention as
    // lsaCallrailTagCategories.rollup.
    lastRollup: text("last_rollup").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniq: unique("lsa_text_conversation_tag_state_unique").on(
      t.lsaClientId,
      t.callrailConversationId,
    ),
  }),
);

export type LsaTextConversationTagState =
  typeof lsaTextConversationTagState.$inferSelect;

// Append-only log of observed "became real" transitions for text
// conversations — the message-side counterpart to callSignedEvents, but
// necessarily an approximation: CallRail has no webhook for a text
// conversation's tag changing, so the only available signal is noticing a
// difference between this sync run and the last one. signedAt is the sync
// run's own execution time, not the true tag-change moment. Never written
// on a conversation's first-ever observation (see the seeding rule in
// lsa-sync.ts) — only on a genuine prior-state-existed-and-differed
// transition — so a client's first sync (or a wide backfill) doesn't
// falsely date every already-Signed historical conversation as "signed
// today". Purely additive: nothing currently reads this table.
export const textConversationSignedEvents = pgTable(
  "text_conversation_signed_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    lsaClientId: uuid("lsa_client_id")
      .notNull()
      .references(() => lsaClients.id, { onDelete: "cascade" }),
    callrailConversationId: text("callrail_conversation_id").notNull(),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // One transition event per conversation — a conversation that later
    // reverts (e.g. re-tagged away from Signed) and transitions back to
    // real again is still the same underlying lead; the first-observed
    // signed moment is what matters, not every subsequent flip.
    uniq: unique("text_conversation_signed_events_unique").on(
      t.lsaClientId,
      t.callrailConversationId,
    ),
    clientIdx: index("text_conversation_signed_events_client_idx").on(
      t.lsaClientId,
    ),
  }),
);

export type TextConversationSignedEvent =
  typeof textConversationSignedEvents.$inferSelect;

// Per-CallRail-company webhook signing secret (CallRail's "Call Modified"
// webhook is configured per-company in CallRail's own UI, each with its own
// secret — not agency-wide like CALLRAIL_API_KEY). Keyed by
// callrail_company_id (CallRail's company_resource_id, e.g.
// "COM338e6107d0eb4712af2d4f2f8a18c900" — same format already used as
// ppc_clients.callrail_company_id / lsa_clients.callrail_company_id) rather
// than a foreign key to either client table, since one CallRail company can
// be shared by a ppc_clients row and an lsa_clients row at once (see the
// hasMatchingPpcClient check in lsa-sync.ts) — the secret belongs to the
// CallRail company, not to either side's client record.
export const callrailWebhookSecrets = pgTable("callrail_webhook_secrets", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  callrailCompanyId: text("callrail_company_id").notNull().unique(),
  secretEncrypted: text("secret_encrypted").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type CallrailWebhookSecret = typeof callrailWebhookSecrets.$inferSelect;

// Append-only log of real-time "became real" moments for CALLS, populated
// by the Call Modified webhook receiver
// (src/app/api/webhooks/callrail/call-modified/route.ts) — the call-side
// counterpart to textConversationSignedEvents, but with a real (not
// approximated) signed_at: the webhook fires at the moment CallRail itself
// records the tag edit, so signed_at is the true sign moment going forward
// from whenever the webhook was configured (CallRail has no way to
// retroactively backfill a historical tag-change timestamp). Keyed by
// callrail_call_id alone (globally unique, no client foreign key) — a call
// belongs to exactly one CallRail company, resolvable later via
// callrail_company_id if ever consumed by a report. Purely additive:
// nothing currently reads this table.
export const callSignedEvents = pgTable(
  "call_signed_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    callrailCallId: text("callrail_call_id").notNull(),
    callrailCompanyId: text("callrail_company_id").notNull(),
    // Which LSA client this specific row's classification belongs to —
    // null only for rows written before this column existed (see below).
    // Two different lsa_clients can share one CallRail company (nothing
    // in the schema prevents it), and each independently computes its own
    // classification for the same call from its own tag-category config —
    // so this can't be a single shared row per call; it's one row PER
    // (call, lsa_client) that matched, all sharing the same signedAt
    // (same real-world sign moment). Without this column,
    // applyRedirectedInContributions in lsa-sync.ts had no way to tell
    // whose classification a row held, so EVERY client sharing that
    // company picked up the same redirect — confirmed via a real scratch
    // test to double-count the same call across both clients' reports.
    lsaClientId: uuid("lsa_client_id").references(() => lsaClients.id, {
      onDelete: "cascade",
    }),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull(),
    // What this call actually contributed toward the LSA signed-date
    // correction (lsa-sync.ts's applySignedDateCorrections/
    // fetchAndBucketLsaCalls) — persisted here, not just derived
    // transiently from a live CallRail fetch, so a LATER sync of the
    // redirect's target date can durably reconstruct the same
    // contribution instead of the correction being erased the next time
    // that date gets recomputed from CallRail's current state alone.
    // Nullable because rows written before this column existed (this
    // table predates it) have no value here — those calls' redirects
    // simply aren't re-applied until manually backfilled.
    isSignedCase: boolean("is_signed_case"),
    isRollupReal: boolean("is_rollup_real"),
    // "GMB" | "PPC" | "LSA" | "PMax" | null — same convention as
    // CallrailSignedCandidate.channel in callrail.ts.
    channel: text("channel"),
    // Which lsa_callrail_tag_categories label(s) this call actually
    // incremented in tag_category_breakdown (e.g. ["Signed"],
    // ["Opportunity"], possibly several) — empty/null when the call never
    // contributed to tag_category_breakdown at all (a repeat caller, since
    // that field is first-time-calls-only; or no matched category).
    // Persisted for the same durability reason as the 3 columns above:
    // without it, the origin-side decrement has nothing to identify which
    // label(s) to remove, and a later resync of the target date alone
    // couldn't reconstruct which label(s) to add back in.
    tagCategoryLabels: text("tag_category_labels").array(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    companyIdx: index("call_signed_events_company_idx").on(t.callrailCompanyId),
    // Replaces the old single-column unique(callrail_call_id) — a call
    // matching more than one lsa_client (shared CallRail company) now
    // gets one row per matching client instead of a single shared row.
    // Postgres treats NULL as distinct from NULL in a unique constraint,
    // so pre-migration rows (lsa_client_id null) don't conflict with each
    // other despite sharing that null value.
    callClientUniq: unique("call_signed_events_call_client_unique").on(
      t.callrailCallId,
      t.lsaClientId,
    ),
  }),
);

export type CallSignedEvent = typeof callSignedEvents.$inferSelect;
