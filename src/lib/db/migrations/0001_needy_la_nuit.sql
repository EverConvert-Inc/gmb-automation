ALTER TABLE "locations" ADD COLUMN "next_poll_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "last_poll_error" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "last_poll_error_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "consecutive_poll_failures" integer DEFAULT 0 NOT NULL;