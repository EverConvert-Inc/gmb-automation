CREATE TABLE IF NOT EXISTS "ppc_reconciliation_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ppc_client_id" uuid NOT NULL,
	"label" text NOT NULL,
	"ads_conversion_action_id" text NOT NULL,
	"ads_conversion_action_name" text DEFAULT '' NOT NULL,
	"source" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ppc_reconciliation_mappings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ppc_reconciliation_mappings" ADD CONSTRAINT "ppc_reconciliation_mappings_ppc_client_id_ppc_clients_id_fk" FOREIGN KEY ("ppc_client_id") REFERENCES "public"."ppc_clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ppc_reconciliation_mappings_client_idx" ON "ppc_reconciliation_mappings" USING btree ("ppc_client_id");