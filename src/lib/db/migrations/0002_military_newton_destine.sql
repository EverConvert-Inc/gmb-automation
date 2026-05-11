CREATE TABLE IF NOT EXISTS "location_performance_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"metric_date" date NOT NULL,
	"metric" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_performance_daily_unique" UNIQUE("location_id","metric_date","metric")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "location_performance_daily" ADD CONSTRAINT "location_performance_daily_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "location_performance_daily_loc_date_idx" ON "location_performance_daily" USING btree ("location_id","metric_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "location_performance_daily_metric_idx" ON "location_performance_daily" USING btree ("metric");