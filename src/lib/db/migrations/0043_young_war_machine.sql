ALTER TABLE "lsa_clients" ADD COLUMN IF NOT EXISTS "state" text;--> statement-breakpoint
ALTER TABLE "ppc_clients" ADD COLUMN IF NOT EXISTS "state" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lsa_clients" ADD CONSTRAINT "lsa_clients_state_check" CHECK ("lsa_clients"."state" IS NULL OR "lsa_clients"."state" IN ('GA','NC','SC','TN','TX'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ppc_clients" ADD CONSTRAINT "ppc_clients_state_check" CHECK ("ppc_clients"."state" IS NULL OR "ppc_clients"."state" IN ('GA','NC','SC','TN','TX'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
