ALTER TABLE "locations" ADD COLUMN "place_website_uri" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "place_rating" numeric(2, 1);--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "place_review_count" integer;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "place_google_maps_uri" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "place_refreshed_at" timestamp with time zone;