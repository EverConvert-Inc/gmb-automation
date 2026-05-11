CREATE TABLE IF NOT EXISTS "serp_rankings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracked_keyword_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"keyword" text NOT NULL,
	"target_url" text NOT NULL,
	"national_rank" integer,
	"national_url" text,
	"geo_rank" integer,
	"geo_url" text,
	"geo_city" text,
	"geo_location_code" integer,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "serp_scan_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text NOT NULL,
	"client_ids" uuid[],
	"total_keywords" integer DEFAULT 0 NOT NULL,
	"completed_keywords" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_message" text,
	"triggered_by" text DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tracked_keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"keyword" text NOT NULL,
	"target_url" text NOT NULL,
	"geo_city" text,
	"geo_location_code" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracked_keywords_unique_per_client" UNIQUE("client_id","keyword","geo_city")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "serp_rankings" ADD CONSTRAINT "serp_rankings_tracked_keyword_id_tracked_keywords_id_fk" FOREIGN KEY ("tracked_keyword_id") REFERENCES "public"."tracked_keywords"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "serp_rankings" ADD CONSTRAINT "serp_rankings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tracked_keywords" ADD CONSTRAINT "tracked_keywords_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "serp_rankings_tracked_checked_idx" ON "serp_rankings" USING btree ("tracked_keyword_id","checked_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "serp_rankings_client_checked_idx" ON "serp_rankings" USING btree ("client_id","checked_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tracked_keywords_client_active_idx" ON "tracked_keywords" USING btree ("client_id","is_active");