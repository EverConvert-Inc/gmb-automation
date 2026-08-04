CREATE TABLE IF NOT EXISTS "lsa_text_conversation_tag_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lsa_client_id" uuid NOT NULL,
	"callrail_conversation_id" text NOT NULL,
	"last_rollup" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lsa_text_conversation_tag_state_unique" UNIQUE("lsa_client_id","callrail_conversation_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "text_conversation_signed_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lsa_client_id" uuid NOT NULL,
	"callrail_conversation_id" text NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "text_conversation_signed_events_unique" UNIQUE("lsa_client_id","callrail_conversation_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lsa_text_conversation_tag_state" ADD CONSTRAINT "lsa_text_conversation_tag_state_lsa_client_id_lsa_clients_id_fk" FOREIGN KEY ("lsa_client_id") REFERENCES "public"."lsa_clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "text_conversation_signed_events" ADD CONSTRAINT "text_conversation_signed_events_lsa_client_id_lsa_clients_id_fk" FOREIGN KEY ("lsa_client_id") REFERENCES "public"."lsa_clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "text_conversation_signed_events_client_idx" ON "text_conversation_signed_events" USING btree ("lsa_client_id");