CREATE TABLE IF NOT EXISTS "ppc_ad_standards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"match" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"campaign_expected" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ad_group_expected" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ppc_ad_standards" ENABLE ROW LEVEL SECURITY;