ALTER TABLE "call_signed_events" ADD COLUMN "is_signed_case" boolean;--> statement-breakpoint
ALTER TABLE "call_signed_events" ADD COLUMN "is_rollup_real" boolean;--> statement-breakpoint
ALTER TABLE "call_signed_events" ADD COLUMN "channel" text;