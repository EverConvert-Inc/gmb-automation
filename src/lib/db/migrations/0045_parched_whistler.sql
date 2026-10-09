CREATE TABLE IF NOT EXISTS "lsa_service_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lsa_client_id" uuid NOT NULL,
	"date" date NOT NULL,
	"enabled_service_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lead_service_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"criteria_available" boolean DEFAULT false NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lsa_service_snapshots_unique" UNIQUE("lsa_client_id","date")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lsa_service_snapshots" ADD CONSTRAINT "lsa_service_snapshots_lsa_client_id_lsa_clients_id_fk" FOREIGN KEY ("lsa_client_id") REFERENCES "public"."lsa_clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lsa_service_snapshots_client_date_idx" ON "lsa_service_snapshots" USING btree ("lsa_client_id","date");