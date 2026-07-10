CREATE TABLE IF NOT EXISTS "lsa_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"google_ads_customer_id" text,
	"google_ads_oauth_token_id" uuid,
	"login_customer_id" text,
	"google_ads_discovered_customers_json" jsonb,
	"callrail_company_id" text,
	"signed_case_tag" text DEFAULT 'Signed' NOT NULL,
	"signed_case_name_filters" text[] DEFAULT ARRAY['LSA']::text[] NOT NULL,
	"last_ads_sync_at" timestamp with time zone,
	"last_callrail_sync_at" timestamp with time zone,
	"last_sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lsa_clients_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lsa_leads_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lsa_client_id" uuid NOT NULL,
	"date" date NOT NULL,
	"phone_call_count" integer DEFAULT 0 NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"booking_count" integer DEFAULT 0 NOT NULL,
	"lead_status_breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"signed_cases" integer DEFAULT 0 NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lsa_leads_daily_unique" UNIQUE("lsa_client_id","date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lsa_report_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lsa_report_recipients_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lsa_sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lsa_client_id" uuid,
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
 ALTER TABLE "lsa_clients" ADD CONSTRAINT "lsa_clients_google_ads_oauth_token_id_oauth_credentials_id_fk" FOREIGN KEY ("google_ads_oauth_token_id") REFERENCES "public"."oauth_credentials"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lsa_leads_daily" ADD CONSTRAINT "lsa_leads_daily_lsa_client_id_lsa_clients_id_fk" FOREIGN KEY ("lsa_client_id") REFERENCES "public"."lsa_clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lsa_sync_jobs" ADD CONSTRAINT "lsa_sync_jobs_lsa_client_id_lsa_clients_id_fk" FOREIGN KEY ("lsa_client_id") REFERENCES "public"."lsa_clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lsa_clients_active_idx" ON "lsa_clients" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lsa_leads_daily_client_date_idx" ON "lsa_leads_daily" USING btree ("lsa_client_id","date");