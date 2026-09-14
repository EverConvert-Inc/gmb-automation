ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "partial_sweep_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "last_partial_sweep_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "last_partial_sweep_detail" text;