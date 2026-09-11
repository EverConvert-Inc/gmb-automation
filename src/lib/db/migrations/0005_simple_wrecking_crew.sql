CREATE TABLE IF NOT EXISTS "review_takedown_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"text" text,
	"reviewer_name" text,
	"review_created_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"detected_missing_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"slack_alerted_at" timestamp with time zone,
	"email_alerted_at" timestamp with time zone,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_takedown_alerts_review_unique" UNIQUE("review_id")
);
--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "missing_since_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_takedown_alerts" ADD CONSTRAINT "review_takedown_alerts_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_takedown_alerts" ADD CONSTRAINT "review_takedown_alerts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_takedown_alerts" ADD CONSTRAINT "review_takedown_alerts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_takedown_alerts_location_idx" ON "review_takedown_alerts" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_takedown_alerts_client_idx" ON "review_takedown_alerts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_takedown_alerts_status_idx" ON "review_takedown_alerts" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_takedown_alerts_confirmed_idx" ON "review_takedown_alerts" USING btree ("confirmed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_missing_idx" ON "reviews" USING btree ("missing_since_at");