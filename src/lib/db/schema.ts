import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import { US_STATE_CODES } from "../us-states";

// Built from the single US_STATE_CODES list (us-states.ts) rather than
// hand-duplicated here, so the DB constraint and every state dropdown in
// the app can never drift apart into accepting different sets.
const US_STATE_CHECK_LIST = sql.raw(
  US_STATE_CODES.map((c) => `'${c}'`).join(","),
);

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
    // Cumulative — never reset on a normal successful poll — so this answers
    // "how often has this fired, ever" directly via SQL, without needing to
    // check Cloud Console. Deliberately separate from lastPollError/
    // consecutivePollFailures: a suspicious-partial-sweep poll is NOT a
    // failure (it didn't throw, backoff/retry logic is untouched) — it's a
    // content-integrity guard on an otherwise-successful poll, and reusing
    // the failure fields would misrepresent it as a connectivity/auth
    // problem in the existing "sync failing" UI badge.
    partialSweepCount: integer("partial_sweep_count").notNull().default(0),
    lastPartialSweepAt: timestamp("last_partial_sweep_at", { withTimezone: true }),
    lastPartialSweepDetail: text("last_partial_sweep_detail"),
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
    // Partial, not a plain unique(reviewId): only one non-resolved (still
    // "confirmed" or "filed") alert per review at a time. A plain unique
    // constraint on reviewId blocked a review from ever getting a fresh
    // alert again once any row existed for it — including a resolved
    // false-positive — so a review genuinely taken down for real later
    // would silently never re-alert. Resolving a row now releases the slot;
    // detectAndConfirmTakedowns' onConflictDoNothing where clause must match
    // this predicate exactly for Postgres to target this specific index.
    uniqActiveReview: uniqueIndex("review_takedown_alerts_active_review_idx")
      .on(t.reviewId)
      .where(sql`${t.status} <> 'resolved'`),
    locationIdx: index("review_takedown_alerts_location_idx").on(t.locationId),
    clientIdx: index("review_takedown_alerts_client_idx").on(t.clientId),
    statusIdx: index("review_takedown_alerts_status_idx").on(t.status),
    confirmedIdx: index("review_takedown_alerts_confirmed_idx").on(t.confirmedAt),
  }),
);

// TEMPORARY — diagnosing the recurring partial-sweep issue (Sept 2026,
// suspiciousPartialSweep in reviews.ts). One row per page fetched from GBP's
// reviews.list, on every full sweep, so the next occurrence gives real
// per-page data (page size, whether Google said there was more, raw response
// headers) instead of inference from aggregate before/after counts. Drop
// this table (and the logging call in fetchReviews/pollReviewsForLocation)
// once the root cause is confirmed and no longer needs live capture.
export const gbpFetchDiagnostics = pgTable(
  "gbp_fetch_diagnostics",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    gbpAccountId: text("gbp_account_id").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    pageNumber: integer("page_number").notNull(),
    pageReviewCount: integer("page_review_count").notNull(),
    hasNextPageToken: boolean("has_next_page_token").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseHeaders: jsonb("response_headers"),
  },
  (t) => ({
    locationIdx: index("gbp_fetch_diagnostics_location_idx").on(t.locationId, t.fetchedAt),
    accountIdx: index("gbp_fetch_diagnostics_account_idx").on(t.gbpAccountId, t.fetchedAt),
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
    // Any US state (all 50 + DC — see us-states.ts), required on new clients
    // at the form/API layer but nullable here for any pre-existing row.
    // Report-side state grouping (report-grouping.ts) only actively buckets
    // GA/NC/SC/TN/TX — a client set to any other state falls into that
    // report's "Unassigned" bucket, same as an unset one. A handful of
    // clients genuinely operate across more than one state under a single
    // row (e.g. GMV Law Group: GA + FL) — this single column can't
    // represent that; those rows keep whichever state was chosen at
    // backfill/creation time as a known simplification.
    state: text("state"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activeIdx: index("ppc_clients_active_idx").on(t.isActive),
    stateCheck: check("ppc_clients_state_check", sql`${t.state} IS NULL OR ${t.state} IN (${US_STATE_CHECK_LIST})`),
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
export type GbpFetchDiagnostic = typeof gbpFetchDiagnostics.$inferSelect;
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
    // Per-client definition of what counts as a genuine lead, used ONLY by
    // the lead-rating dry run and only when the conversation doesn't reveal
    // which service the person wanted. The enabled-services list always
    // wins when the service IS identifiable — this never overrides a
    // service that was switched off. Null means no definition, and an
    // unidentifiable service stays unjudged rather than guessed.
    //
    // Varies by practice area: an injury-based definition fits personal
    // injury clients but not a criminal defence firm, so it is per client
    // rather than inferred from the category.
    leadQualificationDefinition: text("lead_qualification_definition"),
    // Allowlist for automated lead rating. FALSE for every client until
    // explicitly enabled, so widening the rollout is a config change rather
    // than a deploy, and a newly added client can never be swept in.
    leadRatingEnabled: boolean("lead_rating_enabled").notNull().default(false),
    // Round-robin cursor for the every-few-minutes scan: each run takes the
    // least-recently-scanned clients, so every client is covered without any
    // single invocation going near the 300s function limit.
    lastRatedScanAt: timestamp("last_rated_scan_at", { withTimezone: true }),
    lastAdsSyncAt: timestamp("last_ads_sync_at", { withTimezone: true }),
    lastCallrailSyncAt: timestamp("last_callrail_sync_at", { withTimezone: true }),
    lastSyncError: text("last_sync_error"),
    // Same allowed set and same caveat as ppc_clients.state — see that
    // column's comment. ppc_clients and lsa_clients are independent tables
    // with no FK between them, so a client present in both needs this set
    // separately in each row; nothing keeps them in sync automatically.
    state: text("state"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activeIdx: index("lsa_clients_active_idx").on(t.isActive),
    stateCheck: check("lsa_clients_state_check", sql`${t.state} IS NULL OR ${t.state} IN (${US_STATE_CHECK_LIST})`),
  }),
);

export type LsaClient = typeof lsaClients.$inferSelect;

// Daily snapshot of which Local Services *services* (practice areas) were
// switched on for a client, captured because the Google Ads API only ever
// returns CURRENT campaign_criterion state — there is no change history for
// LSA criteria. Without a snapshot per day there is no way to answer "was
// this service enabled when that lead arrived", which is the whole basis of
// deciding whether a lead matches what the ad was actually advertising.
// Nothing can be backfilled: day one is the first day this runs.
export const lsaServiceSnapshots = pgTable(
  "lsa_service_snapshots",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    lsaClientId: uuid("lsa_client_id")
      .notNull()
      .references(() => lsaClients.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    // Just the ENABLED service ids (e.g. "auto_accidents"), for the actual
    // match. Confirmed live that lead.service_id and
    // campaign_criterion.local_service_id.service_id share one string
    // namespace, so these compare directly with no mapping layer.
    enabledServiceIds: text("enabled_service_ids")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    // Every service criterion as returned, including status/negative. Every
    // row observed so far has been ENABLED — if Google ever does surface a
    // paused/removed one, this captures it rather than discarding it.
    criteria: jsonb("criteria").notNull().default(sql`'[]'::jsonb`),
    // { "auto_accidents": 5, ... } for leads created that day. The
    // cross-check: a service producing leads while absent from
    // enabled_service_ids means the criteria don't reflect reality, which
    // is exactly what a mismatch rule must not get wrong.
    leadServiceIds: jsonb("lead_service_ids").notNull().default(sql`'{}'::jsonb`),
    // false when the criterion query failed or returned no service rows. A
    // missing row and a row we couldn't read are NOT the same thing, and an
    // empty enabled list must never be read as "nothing is switched on" —
    // any future rating logic has to refuse to act on criteriaAvailable=false.
    criteriaAvailable: boolean("criteria_available").notNull().default(false),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique("lsa_service_snapshots_unique").on(t.lsaClientId, t.date),
    clientDateIdx: index("lsa_service_snapshots_client_date_idx").on(t.lsaClientId, t.date),
  }),
);

export type LsaServiceSnapshot = typeof lsaServiceSnapshots.$inferSelect;

// Dry-run output for automated LSA lead rating. NOTHING here is sent to
// Google — this records what WOULD be submitted via
// LocalServicesLeadService.ProvideLeadFeedback, so the proposed ratings can
// be reviewed against what the intake team would have chosen before any
// real write is enabled.
//
// Full accounting by design: every unrated lead gets a row, either with a
// proposed rating or with the reason it could not be judged. A lead that
// silently produced nothing would be indistinguishable from one that was
// never looked at.
export const lsaLeadRatingDryRuns = pgTable(
  "lsa_lead_rating_dry_runs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    lsaClientId: uuid("lsa_client_id")
      .notNull()
      .references(() => lsaClients.id, { onDelete: "cascade" }),
    // Google's local_services_lead.id, as text — ids are int64 and must not
    // round-trip through a JS number.
    leadId: text("lead_id").notNull(),
    // True when the intake team had ALREADY rated this lead in the LSA UI
    // (lead_feedback_submitted = true) and we classified it anyway, purely
    // to compare the model against their judgement. Kept distinct from the
    // unrated backlog so the two are never mixed in a count.
    alreadyRated: boolean("already_rated").notNull().default(false),
    leadCreatedAt: timestamp("lead_created_at", { withTimezone: true }),
    leadType: text("lead_type"),
    leadStatus: text("lead_status"),
    // Feedback is requested for every lead in the LSA inbox, not only
    // charged ones, so uncharged leads are included and counted separately
    // rather than skipped.
    leadCharged: boolean("lead_charged"),
    serviceId: text("service_id"),
    categoryId: text("category_id"),
    // "message" | "call_transcript" — which evidence the verdict was based
    // on, or null when the lead could not be judged.
    evidenceSource: text("evidence_source"),
    // A short excerpt only. These are legal intake conversations; enough is
    // kept to review the model's reasoning, never the full transcript.
    evidenceExcerpt: text("evidence_excerpt"),
    // Which service the model judged the person was actually asking about,
    // chosen from the services enabled on the lead's own date, or
    // OTHER_NOT_LISTED / UNKNOWN.
    matchedServiceId: text("matched_service_id"),
    // Whether that service was switched on when the lead arrived, per
    // lsa_service_snapshots for that date — NOT today's list.
    serviceWasEnabled: boolean("service_was_enabled"),
    // GENUINE | SPAM | SOLICITATION | DUPLICATE | NOT_READY_TO_BOOK.
    classification: text("classification"),
    // Whether the model leaned on Google's own service_id/category_id label
    // because the conversation was too thin to identify the service itself.
    // Tracked because that label is exactly the signal we don't trust — this
    // measures how often it actually moves a verdict.
    usedLabelHint: boolean("used_label_hint"),
    // Proposed LocalServicesLeadSurveyAnswer, e.g. "VERY_SATISFIED".
    proposedAnswer: text("proposed_answer"),
    // Proposed LocalServicesLeadSurveyDissatisfiedReason when dissatisfied.
    proposedDissatisfiedReason: text("proposed_dissatisfied_reason"),
    modelReasoning: text("model_reasoning"),
    // Set when no rating could be produced: "no_matching_call",
    // "no_transcription", "no_customer_message", "no_conversation",
    // "ambiguous_match", "model_error", "model_unparseable".
    notJudgedReason: text("not_judged_reason"),
    model: text("model"),
    // Retry bookkeeping. A lead whose call is still in progress, or whose
    // transcript has not landed yet (CallRail takes ~a minute), is written
    // immediately with a retryable reason and picked up again later rather
    // than being silently skipped between runs.
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAfter: timestamp("next_attempt_after", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique("lsa_lead_rating_dry_runs_unique").on(t.lsaClientId, t.leadId),
    clientIdx: index("lsa_lead_rating_dry_runs_client_idx").on(t.lsaClientId),
  }),
);

export type LsaLeadRatingDryRun = typeof lsaLeadRatingDryRuns.$inferSelect;

// Audit trail for ratings actually sent to Google via
// LocalServicesLeadService.ProvideLeadFeedback. That API is write-only with
// no read-back and no way to revise a rating, so an unlogged submission is
// unrecoverable — every attempt is recorded here, successful or not.
//
// The unique index on lead_id is the double-submission guard: the row is
// inserted BEFORE the API call, so a crash between call and write can never
// produce a second submission for the same lead.
export const lsaLeadRatingSubmissions = pgTable(
  "lsa_lead_rating_submissions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    lsaClientId: uuid("lsa_client_id")
      .notNull()
      .references(() => lsaClients.id, { onDelete: "cascade" }),
    leadId: text("lead_id").notNull(),
    leadResourceName: text("lead_resource_name").notNull(),
    surveyAnswer: text("survey_answer").notNull(),
    dissatisfiedReason: text("dissatisfied_reason"),
    // The exact request body sent, so what was submitted is reconstructable
    // even if the rating logic changes afterwards.
    requestPayload: jsonb("request_payload").notNull(),
    status: text("status").notNull(), // "pending" | "ok" | "failed"
    responseBody: text("response_body"),
    errorMessage: text("error_message"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Partial unique, not a plain unique on lead_id: a "pending" or "ok" row
    // claims the lead absolutely, but a "failed" row must NOT block a
    // corrected resubmission. A plain unique meant one rejected request
    // (e.g. a malformed enum) burned the lead permanently — the retry hit
    // onConflictDoNothing and Google was never called again.
    // Same shape as review_takedown_alerts' active-review index.
    uniqLive: uniqueIndex("lsa_lead_rating_submissions_live_lead_idx")
      .on(t.leadId)
      .where(sql`${t.status} <> 'failed'`),
    clientIdx: index("lsa_lead_rating_submissions_client_idx").on(t.lsaClientId),
    // Retries count prior rows per lead to enforce the attempt cap.
    leadIdx: index("lsa_lead_rating_submissions_lead_idx").on(t.leadId),
  }),
);

export type LsaLeadRatingSubmission = typeof lsaLeadRatingSubmissions.$inferSelect;

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

// ===========================================================================
// CLIENT-FACING LEAD TRACKER
//
// Everything below is new and additive. Nothing above this line is read,
// written, or referenced by it — deliberately, including no foreign key to
// clients / ppc_clients / lsa_clients. Those three are independent roots
// with no key joining them (see the comment on lsaClients above: "ppc_clients
// and lsa_clients are independent tables with no FK between them"), so there
// is no existing column that can express "one law firm". lead_firms IS that
// missing root, and it owns its own routing config rather than borrowing
// ppc_clients.callrail_company_id — which is nullable AND non-unique on both
// client tables, the exact ambiguity that makes company->client mapping a
// heuristic today. For an internal aggregate report a heuristic is fine; for
// a surface that decides which law firm sees a lead it is a cross-tenant
// leak, so this side maps companies 1:1 and enforces it in the schema.
//
// Table prefix is `lead_`/`leads` throughout so nothing collides with the 37
// tables above.
//
// Every table below calls .enableRLS() — RLS ON, with NO policies, which is
// deny-all. This is the first table set in this database holding caller PII
// (names and phone numbers), and Supabase's Data API (PostgREST) serves the
// `public` schema to the anon key by default. Without RLS, anyone holding
// NEXT_PUBLIC_SUPABASE_ANON_KEY — which is, by design, in every browser
// bundle — could read these tables over REST without ever touching this app.
//
// ENABLE, deliberately NOT FORCE. Postgres exempts a table's OWNER from row
// security unless FORCE is set, and these tables are owned by whichever role
// runs the migration. The app reaches them as that same role over
// DATABASE_URL (Drizzle on a raw connection — Supabase JS never touches
// data here), so the app is unaffected while anon/authenticated get nothing.
// FORCE would subject the owner too and break the app outright.
//
// The asymmetry to remember if this is ever wrong: a blocked SELECT returns
// ZERO ROWS SILENTLY, it does not raise. A blocked INSERT/UPDATE/DELETE does
// raise. So the symptom of a misconfigured role here is an empty lead list,
// not a crash.
// ===========================================================================

// The tenant root. One row per law firm that logs into the portal.
export const leadFirms = pgTable(
  "lead_firms",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activeIdx: index("lead_firms_active_idx").on(t.isActive),
  }),
).enableRLS();

// Which Supabase user belongs to which firm. Membership in THIS table is what
// makes someone a portal user; internal staff are never in here (they're
// identified by app_metadata.role = 'admin' on the Supabase side, read
// straight off the JWT in middleware — no row here and no DB lookup).
//
// No foreign key to auth.users on purpose: that table lives in Supabase's
// own `auth` schema, which Drizzle does not model and which migrations here
// must not touch. The cost is that deleting a Supabase user leaves an orphan
// row — handled by is_active plus the admin screen, not by a constraint.
export const leadFirmUsers = pgTable(
  "lead_firm_users",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => leadFirms.id, { onDelete: "cascade" }),
    // UNIQUE, and that single constraint is what enforces "a portal user only
    // ever sees one firm." Not a policy in application code that could be
    // forgotten — one row per user, so a second firm's membership is
    // physically unrepresentable.
    authUserId: uuid("auth_user_id").notNull().unique(),
    // Denormalized so the admin user list renders without reaching into
    // Supabase's auth schema for every row. Authoritative copy is auth.users;
    // this one can go stale if an email is changed there.
    email: text("email").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    firmIdx: index("lead_firm_users_firm_idx").on(t.firmId),
  }),
).enableRLS();

// Firm routing rule 1: a lead carrying one of these CallRail tags is copied
// to this firm. Matching is exact, ignoring case.
//
// tag_name_lower is a stored normalized column rather than a lower(tag_name)
// expression index: expression indexes are the one thing drizzle-kit cannot
// reliably round-trip through its snapshot diff, and the hard requirement on
// this migration is SQL that is reviewable and stable across future
// generates. The check constraint below makes Postgres — not application
// discipline — guarantee the two columns agree, so this is strictly safer
// than the expression index it replaces, and the sync's tag lookup becomes a
// plain indexed equality instead of an expression match.
export const leadFirmTags = pgTable(
  "lead_firm_tags",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => leadFirms.id, { onDelete: "cascade" }),
    // As the operator typed it — this is what the admin UI displays.
    tagName: text("tag_name").notNull(),
    tagNameLower: text("tag_name_lower").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // NOT globally unique on the tag: routing rule 1 says a tag matching
    // several firms copies the lead to each of them, so the same tag name
    // across different firms is a supported configuration, not a conflict.
    firmTagUniq: unique("lead_firm_tags_firm_tag_unique").on(t.firmId, t.tagNameLower),
    // The sync resolves firms BY tag, so this is the hot path, not firm_id.
    tagLookupIdx: index("lead_firm_tags_tag_lookup_idx").on(t.tagNameLower),
    lowerCheck: check(
      "lead_firm_tags_lower_check",
      sql`${t.tagNameLower} = lower(${t.tagName})`,
    ),
  }),
).enableRLS();

// Firm routing rule 2: the fallback when no tag matched. UNIQUE on the
// company id, so a CallRail company maps to at most one firm.
//
// This is deliberately STRICTER than ppc_clients.callrail_company_id and
// lsa_clients.callrail_company_id, which are both nullable and non-unique —
// two internal client rows can legitimately share one CallRail company there
// (the webhook receiver uses findMany, not findFirst, precisely because of
// it). Allowing that here would mean a fallback-routed lead has no single
// correct firm, which is a leak rather than a merge. The constraint makes
// the ambiguous state unrepresentable instead of resolving it at runtime.
export const leadFirmCallrailCompanies = pgTable(
  "lead_firm_callrail_companies",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => leadFirms.id, { onDelete: "cascade" }),
    callrailCompanyId: text("callrail_company_id").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    firmIdx: index("lead_firm_callrail_companies_firm_idx").on(t.firmId),
  }),
).enableRLS();

// One row per (lead, firm). A lead whose tags match three firms is three
// rows — copies, not a shared row with a join table, so every portal query
// is a plain firm_id equality and there is no join a future edit can drop.
//
// Two-layer by design: *_parsed columns are owned by the sync and overwritten
// on every run; *_override columns are owned by admins and never touched by
// the sync. The effective value is coalesce(override, parsed), computed at
// read time. This is what lets a resync be a blind upsert without ever
// clobbering a hand correction.
export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    // NULL = the admin queue. Nothing is dropped for want of a firm; an
    // unroutable lead lands here with firm_id null and needs_review true.
    // RESTRICT rather than cascade: deleting a firm that still owns leads
    // should fail loudly, not silently destroy its lead history.
    firmId: uuid("firm_id").references(() => leadFirms.id, { onDelete: "restrict" }),
    source: text("source").notNull(),
    // CallRail's call id or form-submission id. Not unique on its own — the
    // same CallRail record becomes one row per matched firm.
    callrailId: text("callrail_id").notNull(),
    // 'p1', 'p2', ... for a note naming several people. Part of the upsert
    // key so a second person is a sibling row, not a conflict.
    personSuffix: text("person_suffix").notNull().default("p1"),
    callrailCompanyId: text("callrail_company_id").notNull(),
    // The real instant, timestamptz — never a date string derived from
    // toISOString().slice(0,10). The Eastern calendar date is computed at
    // read time via toIsoDateEastern (date-utils.ts), because a 21:10 ET
    // lead is already the NEXT day in UTC and storing a UTC-derived date
    // would put it in the wrong month at a month boundary. That exact bug
    // is already documented in date-utils.test.ts ("the real Weinstein
    // case").
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    // --- raw CallRail payload, ADMIN-ONLY. Never exposed in the portal. ---
    // The tracker/channel the lead came through. Admin-only per spec: a firm
    // should not see which source it was attributed to.
    rawSourceName: text("raw_source_name"),
    rawTrackerId: text("raw_tracker_id"),
    // The CallRail note, verbatim. NEVER client-visible: in a multi-person
    // note it contains other people's names and numbers, and the portal
    // shows only notes typed in the portal itself (lead_notes).
    rawNote: text("raw_note"),
    rawTags: text("raw_tags").array().notNull().default(sql`ARRAY[]::text[]`),
    // Form submissions only — the structured payload CallRail returns when
    // there is no parseable note. The parser reads customer_name and
    // form_data (name / full_name, phone / phone_number) as fallbacks; this
    // keeps the original so a parse failure on a form lead is diagnosable in
    // the admin queue instead of being a dead end.
    rawFormData: jsonb("raw_form_data"),
    // Caller ID from CallRail. The fallback when the note yields no phone.
    customerPhoneCallerid: text("customer_phone_callerid"),
    // --- parsed (sync-owned) / override (admin-owned) ---
    nameParsed: text("name_parsed"),
    phoneParsed: text("phone_parsed"),
    nameOverride: text("name_override"),
    phoneOverride: text("phone_override"),
    statusParsed: text("status_parsed").notNull().default("pending"),
    statusOverride: text("status_override"),
    // Which tag actually won the priority ladder. The status enum is only
    // pending|signed, so Lost / Rejected / No Case / Referred out /
    // No Contact / Declined all collapse into 'pending' — this column is
    // the only place that distinction survives. Load-bearing twice over:
    // the admin view displays it next to the status, and the portal's
    // visibility predicate excludes those six values, so a lost lead is
    // never shown to a firm as an open opportunity.
    statusTagMatched: text("status_tag_matched"),
    isOpportunityParsed: boolean("is_opportunity_parsed").notNull().default(false),
    // Nullable on purpose — three-state. NULL means "no admin opinion, use
    // the parsed value"; false is an explicit admin override to not-an-
    // opportunity, which coalesce() must be able to tell apart from NULL.
    isOpportunityOverride: boolean("is_opportunity_override"),
    // --- the suggested-status "Apply?" flow ---
    // What CallRail's current tags imply, held pending an admin click rather
    // than applied automatically. Status is EverConvert-owned; tags are set
    // by the firm's own staff inside CallRail. They will disagree, and this
    // column is where that disagreement waits.
    suggestedStatus: text("suggested_status"),
    suggestedStatusSeenAt: timestamp("suggested_status_seen_at", { withTimezone: true }),
    // --- signed date ---
    // Decides which month the lead counts in. Fed by the tracker's own
    // Call Modified webhook (receipt time = true sign moment) and, when a
    // delivery was missed, by the previous-month re-check pass.
    signedAt: timestamp("signed_at", { withTimezone: true }),
    signedAtSource: text("signed_at_source"),
    // --- admin queue ---
    // A real column, not a sentinel in note text, so the queue is an indexed
    // predicate rather than a string scan.
    parseFailed: boolean("parse_failed").notNull().default(false),
    parseError: text("parse_error"),
    // Admin queue membership: unassigned (firm_id null) OR parse failure OR
    // a soft-dedup collision. Stored rather than derived so the queue stays
    // one index lookup and so an admin can clear it after review without
    // mutating the underlying reason.
    needsReview: boolean("needs_review").notNull().default(false),
    // Soft dedup only — "one person per phone per firm" is enforced at sync
    // time, not by a constraint. A unique index over coalesce(phone_override,
    // phone_parsed) would be an expression index over admin-mutable columns:
    // a collision would throw mid-sync and fail the whole firm's job, and it
    // could not see the multi-person carve-out. No FK either, so a resolved
    // duplicate can be deleted without this pointer blocking it.
    possibleDuplicateOf: uuid("possible_duplicate_of"),
    // --- client approval ---
    // "Approve for client" in the admin drawer. A lead the portal would not
    // show on its own (Opportunity only, or carrying a negative outcome tag)
    // shows once approved. clientApprovedNegativeTags is the negative tags it
    // carried when approved: a negative tag that arrives later is not covered,
    // so the lead goes back to review. Never written by the sync.
    clientApprovedAt: timestamp("client_approved_at", { withTimezone: true }),
    clientApprovedBy: text("client_approved_by"),
    clientApprovedNegativeTags: text("client_approved_negative_tags").array().notNull().default(sql`ARRAY[]::text[]`),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // The upsert target for routed leads.
    firmCallrailPersonUniq: unique("leads_firm_callrail_person_unique").on(
      t.firmId,
      t.callrailId,
      t.personSuffix,
    ),
    // REQUIRED, not an optimization. Postgres treats NULL as distinct from
    // NULL in a unique constraint, so the constraint above does not
    // constrain unassigned rows at all — without this partial index every
    // sync run would insert a fresh duplicate of every admin-queue lead.
    // Same mechanism, opposite direction, as the call_signed_events comment
    // above (where NULL-distinctness is relied on rather than worked around).
    unassignedUniq: uniqueIndex("leads_unassigned_callrail_person_idx")
      .on(t.callrailId, t.personSuffix)
      .where(sql`${t.firmId} is null`),
    // The portal's only query shape. Ascending on purpose: a btree scans
    // backwards at the same cost, so this serves ORDER BY occurred_at DESC
    // without needing a descending index.
    firmOccurredIdx: index("leads_firm_occurred_idx").on(t.firmId, t.occurredAt),
    // The signed-month view. Partial — most rows never get a signed_at.
    firmSignedIdx: index("leads_firm_signed_idx")
      .on(t.firmId, t.signedAt)
      .where(sql`${t.signedAt} is not null`),
    // Webhook lookup: the receiver knows a callrail_id and nothing else, and
    // has to find every firm's copy of that lead.
    callrailIdx: index("leads_callrail_idx").on(t.callrailId),
    // The admin queue. Partial, so it stays small regardless of table size.
    needsReviewIdx: index("leads_needs_review_idx")
      .on(t.needsReview)
      .where(sql`${t.needsReview}`),
    // The previous-month re-check pass scans still-pending leads by company.
    companyStatusIdx: index("leads_company_status_idx").on(
      t.callrailCompanyId,
      t.statusParsed,
    ),
    // 'text' = a CallRail text conversation thread (migration 0055).
    sourceCheck: check("leads_source_check", sql`${t.source} IN ('call','form','text')`),
    statusParsedCheck: check(
      "leads_status_parsed_check",
      sql`${t.statusParsed} IN ('pending','signed')`,
    ),
    statusOverrideCheck: check(
      "leads_status_override_check",
      sql`${t.statusOverride} IS NULL OR ${t.statusOverride} IN ('pending','signed')`,
    ),
    suggestedStatusCheck: check(
      "leads_suggested_status_check",
      sql`${t.suggestedStatus} IS NULL OR ${t.suggestedStatus} IN ('pending','signed')`,
    ),
    signedAtSourceCheck: check(
      "leads_signed_at_source_check",
      sql`${t.signedAtSource} IS NULL OR ${t.signedAtSource} IN ('webhook','sync','admin')`,
    ),
  }),
).enableRLS();

// Notes typed by a person — in the portal by the firm, or in the admin view
// by staff. This is the ONLY note source the portal ever displays; the
// CallRail note (leads.raw_note) is admin-only.
export const leadNotes = pgTable(
  "lead_notes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    // Denormalized from leads.firm_id deliberately. Every portal query can
    // then filter notes on firm_id directly instead of joining back through
    // leads — a dropped join is the classic way a tenant-scoped query leaks,
    // and this removes the join entirely rather than relying on it being
    // right.
    firmId: uuid("firm_id")
      .notNull()
      .references(() => leadFirms.id, { onDelete: "cascade" }),
    authorKind: text("author_kind").notNull(),
    authorAuthUserId: uuid("author_auth_user_id"),
    authorEmail: text("author_email"),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // "Latest note" is a DISTINCT ON (lead_id) ... ORDER BY created_at DESC
    // or a lateral; either way this is the index it needs.
    leadCreatedIdx: index("lead_notes_lead_created_idx").on(t.leadId, t.createdAt),
    firmIdx: index("lead_notes_firm_idx").on(t.firmId),
    authorKindCheck: check(
      "lead_notes_author_kind_check",
      sql`${t.authorKind} IN ('client','staff')`,
    ),
  }),
).enableRLS();

// One row per sync attempt. Mirrors ppc_sync_jobs (above) plus the window
// that was actually fetched, so a gap in coverage is reconstructable after
// the fact rather than inferred from row timestamps.
//
// error_message is written through this module's own stringifyError copy,
// never a bare (err as Error).message cast — that cast yields undefined for a
// non-Error rejection, which Drizzle's .set() treats as "no fields to
// update" and turns into a masking error that hides the real cause. That was
// a real production incident; see the helper in ppc-sync.ts.
export const leadSyncJobs = pgTable("lead_sync_jobs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  // Null for the full sweep (the cron); populated for a per-firm "Sync Now".
  firmId: uuid("firm_id").references(() => leadFirms.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // 'callrail_calls' | 'callrail_forms'
  status: text("status").notNull(), // 'pending' | 'running' | 'completed' | 'failed'
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  triggeredBy: text("triggered_by").notNull().default("scheduled"),
  // ISO Eastern calendar dates (todayIsoEastern / firstOfMonthIsoEastern),
  // matching what CallRail's start_date/end_date actually accept — those are
  // interpreted in account-local time, not UTC.
  fromDate: date("from_date"),
  toDate: date("to_date"),
  leadsIngested: integer("leads_ingested").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

// The tracker's own webhook secrets, separate from callrail_webhook_secrets.
//
// Not a reuse of that table, and not a schema change to it: its
// callrail_company_id is NOT NULL UNIQUE (one secret per company) and
// PUT /api/callrail/webhook-secret/[companyId] upserts on exactly that
// target. A second Call Modified subscription has its own secret, so writing
// it there would OVERWRITE the production webhook's secret and silently
// break the LSA signed-case pipeline — the same class of silent breakage the
// not-configured branch in the existing receiver was added to prevent.
export const leadWebhookSecrets = pgTable("lead_webhook_secrets", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  callrailCompanyId: text("callrail_company_id").notNull().unique(),
  secretEncrypted: text("secret_encrypted").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

// Landing table for the tracker's Call Modified deliveries.
//
// The receiver writes HERE and nothing else, then returns 2xx. It does not
// update leads inline, because of a real ordering hole: a call tagged minutes
// after it happened fires the webhook before the daily sync has created any
// lead row, so a direct UPDATE leads SET signed_at would match zero rows and
// the receipt time would be lost forever. Landing the event first keeps the
// route a single indexed INSERT (fast, always 2xx — CallRail auto-disables a
// subscription whose endpoint keeps answering non-2xx, which has already
// silently killed two subscriptions on the existing webhook) and lets the
// sync claim it afterwards, preserving the RECEIPT time rather than
// substituting the time the sync happened to run.
//
// INSERT RULE (binding on the Phase 6 receiver): insert ONLY when the
// delivery's tags include Signed, and always .onConflictDoNothing() on
// callrail_id. Non-Signed deliveries are acknowledged with 2xx and dropped
// without a row.
//
// Why the tag filter: CallRail's Call Modified fires on every modification,
// not just a sign. Landing all of them would make this table grow with rows
// that can never produce a signed_at, and would leave the unapplied-events
// index permanently full of work the sync must skip on every pass.
//
// Why DO NOTHING rather than an upsert: received_at is the whole point of
// this table — it is the true sign moment. A redelivery of the same event
// (CallRail retries, and the existing receiver has confirmed duplicate
// deliveries in production) must NOT overwrite the first receipt with a
// later timestamp, which is exactly what onConflictDoUpdate would do. First
// write wins, permanently.
export const leadSignedWebhookEvents = pgTable(
  "lead_signed_webhook_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    callrailId: text("callrail_id").notNull().unique(),
    callrailCompanyId: text("callrail_company_id").notNull(),
    // Tags as they stood at delivery, so the status ladder can be re-run
    // later without a second CallRail fetch.
    tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
    // THIS is the signed timestamp that reaches leads.signed_at — the moment
    // CallRail recorded the tag edit, not the moment a sync noticed it.
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    // Null = not yet consumed by a sync run.
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("lead_signed_webhook_events_company_idx").on(t.callrailCompanyId),
    // The claim query. Partial, so it stays proportional to the backlog
    // rather than to the total number of events ever received.
    unappliedIdx: index("lead_signed_webhook_events_unapplied_idx")
      .on(t.appliedAt)
      .where(sql`${t.appliedAt} is null`),
  }),
).enableRLS();

export type LeadFirm = typeof leadFirms.$inferSelect;
export type LeadFirmUser = typeof leadFirmUsers.$inferSelect;
export type LeadFirmTag = typeof leadFirmTags.$inferSelect;
export type LeadFirmCallrailCompany = typeof leadFirmCallrailCompanies.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type LeadNote = typeof leadNotes.$inferSelect;
export type LeadSyncJob = typeof leadSyncJobs.$inferSelect;
export type LeadWebhookSecret = typeof leadWebhookSecrets.$inferSelect;
export type LeadSignedWebhookEvent = typeof leadSignedWebhookEvents.$inferSelect;

// ---------------------------------------------------------------------------
// Client portal activity log
// ---------------------------------------------------------------------------
//
// One row per thing a client user did in the portal. Append-only from the
// portal; the only other operation is the 13-month retention delete.
//
// Deliberately NO foreign keys: an FK would be an ALTER on this table that
// also locks lead_firms / leads while it is added, and a cascade from leads
// would add work to every lead delete the sync makes. This table must not
// touch any existing table. firm_id / lead_id are plain uuids; the admin read
// left-joins and tolerates a deleted firm or lead.
//
// metadata holds small, non-sensitive values only (preset names, counts,
// which statuses were ticked) — never note text, names, phones, emails,
// search terms, typed dates, IPs or user agents. The check caps its size.
export const portalEvents = pgTable(
  "portal_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    firmId: uuid("firm_id").notNull(),
    authUserId: uuid("auth_user_id").notNull(),
    eventType: text("event_type").notNull(),
    leadId: uuid("lead_id"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => ({
    firmCreatedIdx: index("portal_events_firm_created_idx").on(t.firmId, t.createdAt),
    typeCreatedIdx: index("portal_events_type_created_idx").on(t.eventType, t.createdAt),
    eventTypeCheck: check(
      "portal_events_event_type_check",
      sql`${t.eventType} IN ('sign_in','page_view','note_saved','date_range_changed','status_filter_used','search_used')`,
    ),
    metadataCheck: check(
      "portal_events_metadata_check",
      sql`jsonb_typeof(${t.metadata}) = 'object' AND pg_column_size(${t.metadata}) <= 1024`,
    ),
  }),
).enableRLS();
export type PortalEvent = typeof portalEvents.$inferSelect;

// ---------------------------------------------------------------------------
// Reddit Ads spend report
// ---------------------------------------------------------------------------
//
// Standalone from PPC/LSA: its own client list, accounts, facts and sync
// jobs, with no FK into ppc_clients/lsa_clients (some Reddit clients have no
// PPC row). One agency-wide Reddit login (oauth_credentials, provider
// "reddit_ads") sees every account — owned ones via the business list,
// partner-shared ones only via POST /businesses/{id}/ad_accounts/query.
//
// RLS ON with no policies (deny-all to Supabase's anon/authenticated roles),
// same reasoning as the lead tables above: the app reaches these as the
// owning role over DATABASE_URL, so only the public Data API is shut out.

export const redditClients = pgTable(
  "reddit_clients",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activeIdx: index("reddit_clients_active_idx").on(t.isActive),
  }),
).enableRLS();

// One row per Reddit ad account, created by discovery. The client mapping
// lives here (many accounts -> one client) rather than on the client row,
// because accounts are discovered first and mapped afterwards.
export const redditAdAccounts = pgTable(
  "reddit_ad_accounts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    // Reddit's own id, e.g. "a2_jt8fopuljk60".
    redditAdAccountId: text("reddit_ad_account_id").notNull().unique(),
    name: text("name").notNull(),
    // The account's owning business. Differs from the business we listed it
    // under for partner-shared accounts (is_shared).
    ownerBusinessId: text("owner_business_id"),
    isShared: boolean("is_shared").notNull().default(false),
    // Non-USD accounts still sync but are flagged and excluded from totals.
    currency: text("currency"),
    // Reference only — reports are always requested in America/New_York.
    timeZoneId: text("time_zone_id"),
    redditClientId: uuid("reddit_client_id").references(() => redditClients.id, {
      onDelete: "set null",
    }),
    oauthCredentialId: uuid("oauth_credential_id").references(() => oauthCredentials.id, {
      onDelete: "set null",
    }),
    isActive: boolean("is_active").notNull().default(true),
    // Last discovery run that returned this account; a stale value means
    // the connected login can no longer see it.
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastSyncError: text("last_sync_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    clientIdx: index("reddit_ad_accounts_client_idx").on(t.redditClientId),
  }),
).enableRLS();

// Facts are per account, not per client, so remapping an account to a
// different client needs no resync — the client is joined at query time.
// `date` is the America/New_York calendar date.
export const redditAdsDaily = pgTable(
  "reddit_ads_daily",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    adAccountId: uuid("ad_account_id")
      .notNull()
      .references(() => redditAdAccounts.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    // Reddit reports SPEND in micros of the account currency.
    spendMicros: bigint("spend_micros", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique("reddit_ads_daily_unique").on(t.adAccountId, t.date),
    dateIdx: index("reddit_ads_daily_date_idx").on(t.date),
  }),
).enableRLS();

export const redditSyncJobs = pgTable(
  "reddit_sync_jobs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    // Null for a whole sweep (cron or Sync Now); set for a single account.
    adAccountId: uuid("ad_account_id").references(() => redditAdAccounts.id, {
      onDelete: "cascade",
    }),
    kind: text("kind").notNull(), // 'spend' | 'discovery'
    status: text("status").notNull(), // 'running' | 'completed' | 'failed'
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    triggeredBy: text("triggered_by").notNull().default("scheduled"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
).enableRLS();

export type RedditClient = typeof redditClients.$inferSelect;
export type RedditAdAccount = typeof redditAdAccounts.$inferSelect;
