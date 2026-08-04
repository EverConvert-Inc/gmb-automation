CREATE TABLE IF NOT EXISTS "call_signed_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"callrail_call_id" text NOT NULL,
	"callrail_company_id" text NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_signed_events_callrail_call_id_unique" UNIQUE("callrail_call_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "callrail_webhook_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"callrail_company_id" text NOT NULL,
	"secret_encrypted" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "callrail_webhook_secrets_callrail_company_id_unique" UNIQUE("callrail_company_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "call_signed_events_company_idx" ON "call_signed_events" USING btree ("callrail_company_id");