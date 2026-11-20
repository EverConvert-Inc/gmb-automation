ALTER TABLE "ppc_ads_daily" ADD COLUMN "conversions_value" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "ppc_campaigns" ADD COLUMN "advertising_channel_type" text;