-- Add "Marketing" (junk) to every existing client's tag categories that
-- doesn't already have a category with that label. New clients get it
-- from DEFAULT_CALLRAIL_TAG_CATEGORIES (src/lib/callrail-tag-categories.ts)
-- via the client-creation API routes, same as the original 5 + Wrong
-- Number + Opportunity + Client.
INSERT INTO "ppc_callrail_tag_categories" ("ppc_client_id", "label", "callrail_tag_name", "rollup", "sort_order")
SELECT "ppc_clients"."id", 'Marketing', 'Marketing', 'junk', 8
FROM "ppc_clients"
WHERE NOT EXISTS (
	SELECT 1 FROM "ppc_callrail_tag_categories"
	WHERE "ppc_callrail_tag_categories"."ppc_client_id" = "ppc_clients"."id"
	AND "ppc_callrail_tag_categories"."label" = 'Marketing'
);
--> statement-breakpoint
INSERT INTO "lsa_callrail_tag_categories" ("lsa_client_id", "label", "callrail_tag_name", "rollup", "sort_order")
SELECT "lsa_clients"."id", 'Marketing', 'Marketing', 'junk', 8
FROM "lsa_clients"
WHERE NOT EXISTS (
	SELECT 1 FROM "lsa_callrail_tag_categories"
	WHERE "lsa_callrail_tag_categories"."lsa_client_id" = "lsa_clients"."id"
	AND "lsa_callrail_tag_categories"."label" = 'Marketing'
);
