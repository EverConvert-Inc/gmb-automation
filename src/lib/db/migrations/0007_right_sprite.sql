CREATE TABLE IF NOT EXISTS "ppc_ads_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ppc_client_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"date" date NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"conversions" numeric(14, 2) DEFAULT '0' NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"phone_calls" integer DEFAULT 0 NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ppc_ads_daily_unique" UNIQUE("campaign_id","date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ppc_callrail_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ppc_client_id" uuid NOT NULL,
	"date" date NOT NULL,
	"total_calls" integer DEFAULT 0 NOT NULL,
	"signed_cases" integer DEFAULT 0 NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ppc_callrail_daily_unique" UNIQUE("ppc_client_id","date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ppc_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ppc_client_id" uuid NOT NULL,
	"google_ads_campaign_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ppc_campaigns_unique" UNIQUE("ppc_client_id","google_ads_campaign_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ppc_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"google_ads_customer_id" text,
	"google_ads_oauth_token_id" uuid,
	"callrail_company_id" text,
	"signed_case_tag" text DEFAULT 'signed' NOT NULL,
	"last_ads_sync_at" timestamp with time zone,
	"last_callrail_sync_at" timestamp with time zone,
	"last_sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ppc_clients_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ppc_sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ppc_client_id" uuid,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_message" text,
	"triggered_by" text DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ppc_ads_daily" ADD CONSTRAINT "ppc_ads_daily_ppc_client_id_ppc_clients_id_fk" FOREIGN KEY ("ppc_client_id") REFERENCES "public"."ppc_clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ppc_ads_daily" ADD CONSTRAINT "ppc_ads_daily_campaign_id_ppc_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."ppc_campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ppc_callrail_daily" ADD CONSTRAINT "ppc_callrail_daily_ppc_client_id_ppc_clients_id_fk" FOREIGN KEY ("ppc_client_id") REFERENCES "public"."ppc_clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ppc_campaigns" ADD CONSTRAINT "ppc_campaigns_ppc_client_id_ppc_clients_id_fk" FOREIGN KEY ("ppc_client_id") REFERENCES "public"."ppc_clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ppc_clients" ADD CONSTRAINT "ppc_clients_google_ads_oauth_token_id_oauth_credentials_id_fk" FOREIGN KEY ("google_ads_oauth_token_id") REFERENCES "public"."oauth_credentials"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ppc_sync_jobs" ADD CONSTRAINT "ppc_sync_jobs_ppc_client_id_ppc_clients_id_fk" FOREIGN KEY ("ppc_client_id") REFERENCES "public"."ppc_clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ppc_ads_daily_client_date_idx" ON "ppc_ads_daily" USING btree ("ppc_client_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ppc_campaigns_client_idx" ON "ppc_campaigns" USING btree ("ppc_client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ppc_clients_active_idx" ON "ppc_clients" USING btree ("is_active");