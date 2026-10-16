CREATE TABLE IF NOT EXISTS "portal_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"firm_id" uuid NOT NULL,
	"auth_user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"lead_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "portal_events_event_type_check" CHECK ("portal_events"."event_type" IN ('sign_in','page_view','note_saved','date_range_changed','status_filter_used','search_used')),
	CONSTRAINT "portal_events_metadata_check" CHECK (jsonb_typeof("portal_events"."metadata") = 'object' AND pg_column_size("portal_events"."metadata") <= 1024)
);
--> statement-breakpoint
ALTER TABLE "portal_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_events_firm_created_idx" ON "portal_events" USING btree ("firm_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_events_type_created_idx" ON "portal_events" USING btree ("event_type","created_at");