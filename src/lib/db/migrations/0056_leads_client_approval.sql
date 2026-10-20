ALTER TABLE "leads" ADD COLUMN "client_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "client_approved_by" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "client_approved_negative_tags" text[] DEFAULT ARRAY[]::text[] NOT NULL;