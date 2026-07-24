CREATE TABLE IF NOT EXISTS "lsa_callrail_tag_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lsa_client_id" uuid NOT NULL,
	"label" text NOT NULL,
	"callrail_tag_name" text NOT NULL,
	"rollup" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ppc_callrail_tag_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ppc_client_id" uuid NOT NULL,
	"label" text NOT NULL,
	"callrail_tag_name" text NOT NULL,
	"rollup" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lsa_leads_daily" ADD COLUMN "tag_category_breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ppc_callrail_daily" ADD COLUMN "tag_category_breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ppc_clients" ADD COLUMN "gmb_callrail_name_filters" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lsa_callrail_tag_categories" ADD CONSTRAINT "lsa_callrail_tag_categories_lsa_client_id_lsa_clients_id_fk" FOREIGN KEY ("lsa_client_id") REFERENCES "public"."lsa_clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ppc_callrail_tag_categories" ADD CONSTRAINT "ppc_callrail_tag_categories_ppc_client_id_ppc_clients_id_fk" FOREIGN KEY ("ppc_client_id") REFERENCES "public"."ppc_clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lsa_callrail_tag_categories_client_idx" ON "lsa_callrail_tag_categories" USING btree ("lsa_client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ppc_callrail_tag_categories_client_idx" ON "ppc_callrail_tag_categories" USING btree ("ppc_client_id");--> statement-breakpoint
-- One-time seed: give every existing client the 5 tags the team already
-- uses today (Signed/Pending are "real", the rest are "junk"). New clients
-- created after this migration get the same defaults from the client
-- creation API routes, not from this migration.
INSERT INTO "ppc_callrail_tag_categories" ("ppc_client_id", "label", "callrail_tag_name", "rollup", "sort_order")
SELECT "ppc_clients"."id", v.label, v.tag, v.rollup, v.sort_order
FROM "ppc_clients"
CROSS JOIN (VALUES
	('Signed', 'Signed', 'real', 0),
	('Pending', 'Pending', 'real', 1),
	('Spam', 'Spam', 'junk', 2),
	('Outside of Practice Area', 'Outside of Practice Area', 'junk', 3),
	('Outside of Service Area', 'Outside of Service Area', 'junk', 4)
) AS v(label, tag, rollup, sort_order);--> statement-breakpoint
INSERT INTO "lsa_callrail_tag_categories" ("lsa_client_id", "label", "callrail_tag_name", "rollup", "sort_order")
SELECT "lsa_clients"."id", v.label, v.tag, v.rollup, v.sort_order
FROM "lsa_clients"
CROSS JOIN (VALUES
	('Signed', 'Signed', 'real', 0),
	('Pending', 'Pending', 'real', 1),
	('Spam', 'Spam', 'junk', 2),
	('Outside of Practice Area', 'Outside of Practice Area', 'junk', 3),
	('Outside of Service Area', 'Outside of Service Area', 'junk', 4)
) AS v(label, tag, rollup, sort_order);