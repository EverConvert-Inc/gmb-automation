-- Remove "Signed" as a default Call Quality tag category. "Opportunity"
-- (migration 0019) is now the sole real-rollup tag going forward. Only
-- removes the row if it's still the pristine default (label,
-- callrail_tag_name, and rollup all unchanged) — a client that genuinely
-- customized it (renamed the CallRail tag, or flipped the rollup) keeps
-- their row untouched. sort_order is intentionally excluded from the
-- match since reordering isn't a customization.
--
-- Unrelated to ppc_clients/lsa_clients.signed_case_tag and
-- signed_case_name_filters, which power the separate "Signed Cases" KPI
-- on /ppc, /lsa, and PDFs — not touched by this migration.
DELETE FROM "ppc_callrail_tag_categories"
WHERE "label" = 'Signed'
	AND "callrail_tag_name" = 'Signed'
	AND "rollup" = 'real';
--> statement-breakpoint
DELETE FROM "lsa_callrail_tag_categories"
WHERE "label" = 'Signed'
	AND "callrail_tag_name" = 'Signed'
	AND "rollup" = 'real';
