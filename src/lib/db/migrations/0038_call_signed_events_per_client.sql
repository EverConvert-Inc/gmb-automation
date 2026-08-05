ALTER TABLE "call_signed_events" DROP CONSTRAINT "call_signed_events_callrail_call_id_unique";--> statement-breakpoint
ALTER TABLE "call_signed_events" ADD COLUMN "lsa_client_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "call_signed_events" ADD CONSTRAINT "call_signed_events_lsa_client_id_lsa_clients_id_fk" FOREIGN KEY ("lsa_client_id") REFERENCES "public"."lsa_clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "call_signed_events" ADD CONSTRAINT "call_signed_events_call_client_unique" UNIQUE("callrail_call_id","lsa_client_id");