CREATE TABLE IF NOT EXISTS "lsa_lead_rating_dry_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lsa_client_id" uuid NOT NULL,
	"lead_id" text NOT NULL,
	"lead_created_at" timestamp with time zone,
	"lead_type" text,
	"lead_status" text,
	"lead_charged" boolean,
	"service_id" text,
	"category_id" text,
	"evidence_source" text,
	"evidence_excerpt" text,
	"proposed_answer" text,
	"proposed_dissatisfied_reason" text,
	"model_reasoning" text,
	"not_judged_reason" text,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lsa_lead_rating_dry_runs_unique" UNIQUE("lsa_client_id","lead_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lsa_lead_rating_dry_runs" ADD CONSTRAINT "lsa_lead_rating_dry_runs_lsa_client_id_lsa_clients_id_fk" FOREIGN KEY ("lsa_client_id") REFERENCES "public"."lsa_clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lsa_lead_rating_dry_runs_client_idx" ON "lsa_lead_rating_dry_runs" USING btree ("lsa_client_id");