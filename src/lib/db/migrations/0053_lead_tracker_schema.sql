CREATE TABLE IF NOT EXISTS "lead_firm_callrail_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"callrail_company_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_firm_callrail_companies_callrail_company_id_unique" UNIQUE("callrail_company_id")
);
--> statement-breakpoint
ALTER TABLE "lead_firm_callrail_companies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_firm_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"tag_name" text NOT NULL,
	"tag_name_lower" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_firm_tags_firm_tag_unique" UNIQUE("firm_id","tag_name_lower"),
	CONSTRAINT "lead_firm_tags_lower_check" CHECK ("lead_firm_tags"."tag_name_lower" = lower("lead_firm_tags"."tag_name"))
);
--> statement-breakpoint
ALTER TABLE "lead_firm_tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_firm_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"auth_user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_firm_users_auth_user_id_unique" UNIQUE("auth_user_id")
);
--> statement-breakpoint
ALTER TABLE "lead_firm_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_firms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_firms_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "lead_firms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"firm_id" uuid NOT NULL,
	"author_kind" text NOT NULL,
	"author_auth_user_id" uuid,
	"author_email" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_notes_author_kind_check" CHECK ("lead_notes"."author_kind" IN ('client','staff'))
);
--> statement-breakpoint
ALTER TABLE "lead_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_signed_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"callrail_id" text NOT NULL,
	"callrail_company_id" text NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_signed_webhook_events_callrail_id_unique" UNIQUE("callrail_id")
);
--> statement-breakpoint
ALTER TABLE "lead_signed_webhook_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_message" text,
	"triggered_by" text DEFAULT 'scheduled' NOT NULL,
	"from_date" date,
	"to_date" date,
	"leads_ingested" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_sync_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_webhook_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"callrail_company_id" text NOT NULL,
	"secret_encrypted" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_webhook_secrets_callrail_company_id_unique" UNIQUE("callrail_company_id")
);
--> statement-breakpoint
ALTER TABLE "lead_webhook_secrets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid,
	"source" text NOT NULL,
	"callrail_id" text NOT NULL,
	"person_suffix" text DEFAULT 'p1' NOT NULL,
	"callrail_company_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"raw_source_name" text,
	"raw_tracker_id" text,
	"raw_note" text,
	"raw_tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"raw_form_data" jsonb,
	"customer_phone_callerid" text,
	"name_parsed" text,
	"phone_parsed" text,
	"name_override" text,
	"phone_override" text,
	"status_parsed" text DEFAULT 'pending' NOT NULL,
	"status_override" text,
	"status_tag_matched" text,
	"is_opportunity_parsed" boolean DEFAULT false NOT NULL,
	"is_opportunity_override" boolean,
	"suggested_status" text,
	"suggested_status_seen_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"signed_at_source" text,
	"parse_failed" boolean DEFAULT false NOT NULL,
	"parse_error" text,
	"needs_review" boolean DEFAULT false NOT NULL,
	"possible_duplicate_of" uuid,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_firm_callrail_person_unique" UNIQUE("firm_id","callrail_id","person_suffix"),
	CONSTRAINT "leads_source_check" CHECK ("leads"."source" IN ('call','form')),
	CONSTRAINT "leads_status_parsed_check" CHECK ("leads"."status_parsed" IN ('pending','signed')),
	CONSTRAINT "leads_status_override_check" CHECK ("leads"."status_override" IS NULL OR "leads"."status_override" IN ('pending','signed')),
	CONSTRAINT "leads_suggested_status_check" CHECK ("leads"."suggested_status" IS NULL OR "leads"."suggested_status" IN ('pending','signed')),
	CONSTRAINT "leads_signed_at_source_check" CHECK ("leads"."signed_at_source" IS NULL OR "leads"."signed_at_source" IN ('webhook','sync','admin'))
);
--> statement-breakpoint
ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_firm_callrail_companies" ADD CONSTRAINT "lead_firm_callrail_companies_firm_id_lead_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."lead_firms"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_firm_tags" ADD CONSTRAINT "lead_firm_tags_firm_id_lead_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."lead_firms"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_firm_users" ADD CONSTRAINT "lead_firm_users_firm_id_lead_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."lead_firms"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_firm_id_lead_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."lead_firms"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_sync_jobs" ADD CONSTRAINT "lead_sync_jobs_firm_id_lead_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."lead_firms"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_firm_id_lead_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."lead_firms"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_firm_callrail_companies_firm_idx" ON "lead_firm_callrail_companies" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_firm_tags_tag_lookup_idx" ON "lead_firm_tags" USING btree ("tag_name_lower");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_firm_users_firm_idx" ON "lead_firm_users" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_firms_active_idx" ON "lead_firms" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_notes_lead_created_idx" ON "lead_notes" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_notes_firm_idx" ON "lead_notes" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_signed_webhook_events_company_idx" ON "lead_signed_webhook_events" USING btree ("callrail_company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_signed_webhook_events_unapplied_idx" ON "lead_signed_webhook_events" USING btree ("applied_at") WHERE "lead_signed_webhook_events"."applied_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "leads_unassigned_callrail_person_idx" ON "leads" USING btree ("callrail_id","person_suffix") WHERE "leads"."firm_id" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_firm_occurred_idx" ON "leads" USING btree ("firm_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_firm_signed_idx" ON "leads" USING btree ("firm_id","signed_at") WHERE "leads"."signed_at" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_callrail_idx" ON "leads" USING btree ("callrail_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_needs_review_idx" ON "leads" USING btree ("needs_review") WHERE "leads"."needs_review";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_company_status_idx" ON "leads" USING btree ("callrail_company_id","status_parsed");