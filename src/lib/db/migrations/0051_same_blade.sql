CREATE TABLE IF NOT EXISTS "lsa_lead_rating_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lsa_client_id" uuid NOT NULL,
	"lead_id" text NOT NULL,
	"lead_resource_name" text NOT NULL,
	"survey_answer" text NOT NULL,
	"dissatisfied_reason" text,
	"request_payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"response_body" text,
	"error_message" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lsa_lead_rating_submissions_lead_unique" UNIQUE("lead_id")
);
--> statement-breakpoint
ALTER TABLE "lsa_clients" ADD COLUMN "lead_rating_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lsa_clients" ADD COLUMN "last_rated_scan_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lsa_lead_rating_dry_runs" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "lsa_lead_rating_dry_runs" ADD COLUMN "next_attempt_after" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lsa_lead_rating_submissions" ADD CONSTRAINT "lsa_lead_rating_submissions_lsa_client_id_lsa_clients_id_fk" FOREIGN KEY ("lsa_client_id") REFERENCES "public"."lsa_clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lsa_lead_rating_submissions_client_idx" ON "lsa_lead_rating_submissions" USING btree ("lsa_client_id");