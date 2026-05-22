ALTER TABLE "tracked_keywords" ADD COLUMN "geo_lat" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "tracked_keywords" ADD COLUMN "geo_lng" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "tracked_keywords" ADD COLUMN "geo_formatted" text;