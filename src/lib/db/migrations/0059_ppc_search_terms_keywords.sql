CREATE TABLE IF NOT EXISTS "ppc_keywords_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ppc_client_id" uuid NOT NULL,
	"date" date NOT NULL,
	"google_ads_campaign_id" text NOT NULL,
	"campaign_name" text NOT NULL,
	"ad_group_id" text NOT NULL,
	"ad_group_name" text NOT NULL,
	"criterion_id" text NOT NULL,
	"keyword_text" text NOT NULL,
	"match_type" text NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"conversions" numeric(14, 2) DEFAULT '0' NOT NULL,
	"conversions_value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ppc_keywords_daily_unique" UNIQUE("ppc_client_id","ad_group_id","criterion_id","date")
);
--> statement-breakpoint
ALTER TABLE "ppc_keywords_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ppc_search_terms_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ppc_client_id" uuid NOT NULL,
	"date" date NOT NULL,
	"google_ads_campaign_id" text NOT NULL,
	"campaign_name" text NOT NULL,
	"ad_group_id" text NOT NULL,
	"ad_group_name" text NOT NULL,
	"search_term" text NOT NULL,
	"search_term_hash" text NOT NULL,
	"keyword_text" text DEFAULT '' NOT NULL,
	"keyword_match_type" text DEFAULT '' NOT NULL,
	"search_term_match_type" text DEFAULT '' NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"conversions" numeric(14, 2) DEFAULT '0' NOT NULL,
	"conversions_value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ppc_search_terms_daily_unique" UNIQUE("ppc_client_id","date","ad_group_id","search_term_hash","keyword_text","keyword_match_type","search_term_match_type")
);
--> statement-breakpoint
ALTER TABLE "ppc_search_terms_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ppc_keywords_daily" ADD CONSTRAINT "ppc_keywords_daily_ppc_client_id_ppc_clients_id_fk" FOREIGN KEY ("ppc_client_id") REFERENCES "public"."ppc_clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ppc_search_terms_daily" ADD CONSTRAINT "ppc_search_terms_daily_ppc_client_id_ppc_clients_id_fk" FOREIGN KEY ("ppc_client_id") REFERENCES "public"."ppc_clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ppc_keywords_daily_client_date_idx" ON "ppc_keywords_daily" USING btree ("ppc_client_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ppc_search_terms_daily_client_date_idx" ON "ppc_search_terms_daily" USING btree ("ppc_client_id","date");