ALTER TABLE "ppc_account_health_daily" ADD COLUMN IF NOT EXISTS "junk_actions" jsonb;--> statement-breakpoint
ALTER TABLE "ppc_account_health_daily" ADD COLUMN IF NOT EXISTS "day_spend_micros" bigint;
