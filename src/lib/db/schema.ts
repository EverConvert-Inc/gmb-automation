import { sql } from "drizzle-orm";
import {
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
    status: text("status").notNull().default("active"),
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

export type Client = typeof clients.$inferSelect;
export type Location = typeof locations.$inferSelect;
export type Keyword = typeof keywords.$inferSelect;
export type GridConfig = typeof gridConfigs.$inferSelect;
export type Scan = typeof scans.$inferSelect;
export type ScanPoint = typeof scanPoints.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type LocationDailyMetric = typeof locationDailyMetrics.$inferSelect;
export type OauthCredential = typeof oauthCredentials.$inferSelect;
