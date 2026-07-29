-- Remove "Pending" as a default Call Quality tag category. "Signed" is
-- now the sole real-rollup tag going forward. Only removes the row if
-- it's still the pristine default (label, callrail_tag_name, and rollup
-- all unchanged) — a client that genuinely customized it (renamed the
-- CallRail tag, or flipped the rollup) keeps their row untouched.
-- sort_order is intentionally excluded from the match since reordering
-- isn't a customization. Same pattern as 0029's Signed removal.
DELETE FROM "ppc_callrail_tag_categories"
WHERE "label" = 'Pending'
	AND "callrail_tag_name" = 'Pending'
	AND "rollup" = 'real';
--> statement-breakpoint
DELETE FROM "lsa_callrail_tag_categories"
WHERE "label" = 'Pending'
	AND "callrail_tag_name" = 'Pending'
	AND "rollup" = 'real';
