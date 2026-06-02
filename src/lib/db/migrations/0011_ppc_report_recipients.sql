CREATE TABLE IF NOT EXISTS "ppc_report_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ppc_report_recipients_email_unique" UNIQUE("email")
);
