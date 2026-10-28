CREATE TABLE IF NOT EXISTS "reddit_ad_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reddit_ad_account_id" text NOT NULL,
	"name" text NOT NULL,
	"owner_business_id" text,
	"is_shared" boolean DEFAULT false NOT NULL,
	"currency" text,
	"time_zone_id" text,
	"reddit_client_id" uuid,
	"oauth_credential_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reddit_ad_accounts_reddit_ad_account_id_unique" UNIQUE("reddit_ad_account_id")
);
--> statement-breakpoint
ALTER TABLE "reddit_ad_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reddit_ads_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"spend_micros" bigint DEFAULT 0 NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reddit_ads_daily_unique" UNIQUE("ad_account_id","date")
);
--> statement-breakpoint
ALTER TABLE "reddit_ads_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reddit_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reddit_clients_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "reddit_clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reddit_sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ad_account_id" uuid,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_message" text,
	"triggered_by" text DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reddit_sync_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reddit_ad_accounts" ADD CONSTRAINT "reddit_ad_accounts_reddit_client_id_reddit_clients_id_fk" FOREIGN KEY ("reddit_client_id") REFERENCES "public"."reddit_clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reddit_ad_accounts" ADD CONSTRAINT "reddit_ad_accounts_oauth_credential_id_oauth_credentials_id_fk" FOREIGN KEY ("oauth_credential_id") REFERENCES "public"."oauth_credentials"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reddit_ads_daily" ADD CONSTRAINT "reddit_ads_daily_ad_account_id_reddit_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."reddit_ad_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reddit_sync_jobs" ADD CONSTRAINT "reddit_sync_jobs_ad_account_id_reddit_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."reddit_ad_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reddit_ad_accounts_client_idx" ON "reddit_ad_accounts" USING btree ("reddit_client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reddit_ads_daily_date_idx" ON "reddit_ads_daily" USING btree ("date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reddit_clients_active_idx" ON "reddit_clients" USING btree ("is_active");