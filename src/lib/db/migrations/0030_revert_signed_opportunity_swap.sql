-- Revert migration 0029's Signed/Opportunity swap: restore "Signed"
-- (real) as a default tag category, remove "Opportunity" as a default.
-- "Signed" is once again the sole real-rollup tag going forward.
--
-- Add Signed back for every client that doesn't currently have a
-- Signed-labeled row (independent of their Opportunity state).
INSERT INTO "ppc_callrail_tag_categories" ("ppc_client_id", "label", "callrail_tag_name", "rollup", "sort_order")
SELECT "ppc_clients"."id", 'Signed', 'Signed', 'real', 0
FROM "ppc_clients"
WHERE NOT EXISTS (
	SELECT 1 FROM "ppc_callrail_tag_categories"
	WHERE "ppc_callrail_tag_categories"."ppc_client_id" = "ppc_clients"."id"
	AND "ppc_callrail_tag_categories"."label" = 'Signed'
);
--> statement-breakpoint
INSERT INTO "lsa_callrail_tag_categories" ("lsa_client_id", "label", "callrail_tag_name", "rollup", "sort_order")
SELECT "lsa_clients"."id", 'Signed', 'Signed', 'real', 0
FROM "lsa_clients"
WHERE NOT EXISTS (
	SELECT 1 FROM "lsa_callrail_tag_categories"
	WHERE "lsa_callrail_tag_categories"."lsa_client_id" = "lsa_clients"."id"
	AND "lsa_callrail_tag_categories"."label" = 'Signed'
);
--> statement-breakpoint
-- Remove Opportunity only where it's still the pristine default added by
-- 0019 — a client that genuinely customized it (different tag name or
-- rollup) keeps their row untouched.
DELETE FROM "ppc_callrail_tag_categories"
WHERE "label" = 'Opportunity'
	AND "callrail_tag_name" = 'Opportunity'
	AND "rollup" = 'real';
--> statement-breakpoint
DELETE FROM "lsa_callrail_tag_categories"
WHERE "label" = 'Opportunity'
	AND "callrail_tag_name" = 'Opportunity'
	AND "rollup" = 'real';
