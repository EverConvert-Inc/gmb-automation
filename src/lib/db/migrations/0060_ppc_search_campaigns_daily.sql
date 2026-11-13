CREATE TABLE IF NOT EXISTS "ppc_search_campaigns_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ppc_client_id" uuid NOT NULL,
	"date" date NOT NULL,
	"google_ads_campaign_id" text NOT NULL,
	"campaign_name" text NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"conversions" numeric(14, 2) DEFAULT '0' NOT NULL,
	"conversions_value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ppc_search_campaigns_daily_unique" UNIQUE("ppc_client_id","google_ads_campaign_id","date")
);
--> statement-breakpoint
ALTER TABLE "ppc_search_campaigns_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ppc_search_campaigns_daily" ADD CONSTRAINT "ppc_search_campaigns_daily_ppc_client_id_ppc_clients_id_fk" FOREIGN KEY ("ppc_client_id") REFERENCES "public"."ppc_clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ppc_search_campaigns_daily_client_date_idx" ON "ppc_search_campaigns_daily" USING btree ("ppc_client_id","date");