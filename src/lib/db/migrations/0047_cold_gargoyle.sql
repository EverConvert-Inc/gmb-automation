ALTER TABLE "lsa_lead_rating_dry_runs" ADD COLUMN "matched_service_id" text;--> statement-breakpoint
ALTER TABLE "lsa_lead_rating_dry_runs" ADD COLUMN "service_was_enabled" boolean;--> statement-breakpoint
ALTER TABLE "lsa_lead_rating_dry_runs" ADD COLUMN "classification" text;