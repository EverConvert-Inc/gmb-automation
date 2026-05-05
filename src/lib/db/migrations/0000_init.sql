CREATE TABLE IF NOT EXISTS "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "grid_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"size" integer NOT NULL,
	"radius_miles" numeric(6, 2) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"keyword" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "keywords_unique_per_location" UNIQUE("location_id","keyword")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "location_daily_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"metric_date" date NOT NULL,
	"rating" numeric(2, 1),
	"review_count" integer DEFAULT 0 NOT NULL,
	"reviews_last_30d" integer DEFAULT 0 NOT NULL,
	"reviews_last_90d" integer DEFAULT 0 NOT NULL,
	"days_since_last_review" integer,
	CONSTRAINT "location_daily_metrics_unique" UNIQUE("location_id","metric_date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"place_id" text NOT NULL,
	"lat" numeric(10, 7) NOT NULL,
	"lng" numeric(10, 7) NOT NULL,
	"gbp_account_id" text,
	"gbp_location_id" text,
	"gbp_oauth_token_id" uuid,
	"poll_frequency" text DEFAULT 'daily' NOT NULL,
	"last_polled_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"account_email" text NOT NULL,
	"access_token_encrypted" text NOT NULL,
	"refresh_token_encrypted" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"gbp_review_id" text NOT NULL,
	"rating" integer NOT NULL,
	"text" text,
	"reviewer_name" text,
	"reviewer_photo_url" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reply_text" text,
	"reply_status" text,
	"replied_at" timestamp with time zone,
	CONSTRAINT "reviews_gbp_review_id_unique" UNIQUE("gbp_review_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scan_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"keyword_id" uuid NOT NULL,
	"grid_x" integer NOT NULL,
	"grid_y" integer NOT NULL,
	"lat" numeric(10, 7) NOT NULL,
	"lng" numeric(10, 7) NOT NULL,
	"rank" integer,
	"competitors_json" jsonb,
	"raw_response_ref" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"errored_at" timestamp with time zone,
	"error_detail" text,
	CONSTRAINT "scan_points_unique" UNIQUE("scan_id","keyword_id","grid_x","grid_y")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"grid_config_id" uuid NOT NULL,
	"triggered_by" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"status" text DEFAULT 'queued' NOT NULL,
	"error_detail" text,
	"total_points" integer DEFAULT 0 NOT NULL,
	"total_keywords" integer DEFAULT 0 NOT NULL,
	"cost_estimate" numeric(10, 4)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grid_configs" ADD CONSTRAINT "grid_configs_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "keywords" ADD CONSTRAINT "keywords_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "location_daily_metrics" ADD CONSTRAINT "location_daily_metrics_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "locations" ADD CONSTRAINT "locations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "locations" ADD CONSTRAINT "locations_gbp_oauth_token_id_oauth_credentials_id_fk" FOREIGN KEY ("gbp_oauth_token_id") REFERENCES "public"."oauth_credentials"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reviews" ADD CONSTRAINT "reviews_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scan_points" ADD CONSTRAINT "scan_points_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scan_points" ADD CONSTRAINT "scan_points_keyword_id_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."keywords"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scans" ADD CONSTRAINT "scans_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scans" ADD CONSTRAINT "scans_grid_config_id_grid_configs_id_fk" FOREIGN KEY ("grid_config_id") REFERENCES "public"."grid_configs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_status_idx" ON "clients" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grid_configs_location_idx" ON "grid_configs" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "keywords_location_idx" ON "keywords" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "location_daily_metrics_loc_date_idx" ON "location_daily_metrics" USING btree ("location_id","metric_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "locations_client_idx" ON "locations" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "locations_place_idx" ON "locations" USING btree ("place_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "locations_poll_idx" ON "locations" USING btree ("last_polled_at","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_location_idx" ON "reviews" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_created_idx" ON "reviews" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_rating_idx" ON "reviews" USING btree ("rating");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scan_points_scan_idx" ON "scan_points" USING btree ("scan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scan_points_keyword_idx" ON "scan_points" USING btree ("keyword_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scans_location_idx" ON "scans" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scans_status_idx" ON "scans" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scans_started_idx" ON "scans" USING btree ("started_at");