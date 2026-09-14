CREATE TABLE IF NOT EXISTS "gbp_fetch_diagnostics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"gbp_account_id" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"page_number" integer NOT NULL,
	"page_review_count" integer NOT NULL,
	"has_next_page_token" boolean NOT NULL,
	"response_status" integer NOT NULL,
	"response_headers" jsonb
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gbp_fetch_diagnostics" ADD CONSTRAINT "gbp_fetch_diagnostics_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gbp_fetch_diagnostics_location_idx" ON "gbp_fetch_diagnostics" USING btree ("location_id","fetched_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gbp_fetch_diagnostics_account_idx" ON "gbp_fetch_diagnostics" USING btree ("gbp_account_id","fetched_at");