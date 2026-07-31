CREATE TABLE IF NOT EXISTS "fb_lead_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"page_id" text NOT NULL,
	"page_access_token_encrypted" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fb_lead_clients_slug_unique" UNIQUE("slug"),
	CONSTRAINT "fb_lead_clients_page_id_unique" UNIQUE("page_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fb_lead_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fb_lead_recipients_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fb_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fb_lead_client_id" uuid NOT NULL,
	"page_id" text NOT NULL,
	"form_id" text NOT NULL,
	"leadgen_id" text NOT NULL,
	"full_name" text,
	"email" text,
	"phone" text,
	"state" text,
	"field_data" jsonb NOT NULL,
	"email_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fb_leads_leadgen_id_unique" UNIQUE("leadgen_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fb_leads" ADD CONSTRAINT "fb_leads_fb_lead_client_id_fb_lead_clients_id_fk" FOREIGN KEY ("fb_lead_client_id") REFERENCES "public"."fb_lead_clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fb_lead_clients_page_idx" ON "fb_lead_clients" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fb_lead_clients_active_idx" ON "fb_lead_clients" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fb_leads_client_idx" ON "fb_leads" USING btree ("fb_lead_client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fb_leads_created_idx" ON "fb_leads" USING btree ("created_at");