CREATE TABLE IF NOT EXISTS "ppc_account_health_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ppc_client_id" uuid NOT NULL,
	"date" date NOT NULL,
	"month_start" date NOT NULL,
	"days_elapsed" integer NOT NULL,
	"daily_budget_micros" bigint DEFAULT 0 NOT NULL,
	"budget_count" integer DEFAULT 0 NOT NULL,
	"shared_budget_count" integer DEFAULT 0 NOT NULL,
	"excluded_budget_count" integer DEFAULT 0 NOT NULL,
	"mtd_spend_micros" bigint DEFAULT 0 NOT NULL,
	"search_impression_share" numeric(7, 4),
	"search_budget_lost_share" numeric(7, 4),
	"search_rank_lost_share" numeric(7, 4),
	"optimization_score" numeric(7, 4),
	"conversions" numeric(14, 2),
	"junk_conversions" numeric(14, 2),
	"review_conversions" numeric(14, 2),
	"pull_errors" text,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ppc_account_health_daily_unique" UNIQUE("ppc_client_id","date")
);
--> statement-breakpoint
ALTER TABLE "ppc_account_health_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ppc_account_health_daily" ADD CONSTRAINT "ppc_account_health_daily_ppc_client_id_ppc_clients_id_fk" FOREIGN KEY ("ppc_client_id") REFERENCES "public"."ppc_clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ppc_account_health_daily_date_idx" ON "ppc_account_health_daily" USING btree ("date");