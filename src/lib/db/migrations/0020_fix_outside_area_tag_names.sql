-- Fix "Outside of Practice Area"/"Outside of Service Area" -> "Outside
-- Practice Area"/"Outside Service Area" (no "of"), matching the actual
-- CallRail tag names in use. The old default's callrail_tag_name never
-- matched a real call's tags, so those calls fell into Unclassified
-- instead of Junk.
--
-- label and callrail_tag_name are updated independently, each only where
-- THAT column still holds the exact old wrong text — not gated on the
-- other column's value. label is a cosmetic display string; callrail_tag_name
-- is what actually gets matched against a call's tags. A client who
-- renamed only one of the two isn't assumed to have meant anything about
-- the other, so a customized column is never touched, while a still-
-- default column gets corrected regardless of what its sibling column
-- currently holds.
UPDATE "ppc_callrail_tag_categories"
SET "callrail_tag_name" = 'Outside Practice Area'
WHERE "callrail_tag_name" = 'Outside of Practice Area';
--> statement-breakpoint
UPDATE "ppc_callrail_tag_categories"
SET "label" = 'Outside Practice Area'
WHERE "label" = 'Outside of Practice Area';
--> statement-breakpoint
UPDATE "ppc_callrail_tag_categories"
SET "callrail_tag_name" = 'Outside Service Area'
WHERE "callrail_tag_name" = 'Outside of Service Area';
--> statement-breakpoint
UPDATE "ppc_callrail_tag_categories"
SET "label" = 'Outside Service Area'
WHERE "label" = 'Outside of Service Area';
--> statement-breakpoint
UPDATE "lsa_callrail_tag_categories"
SET "callrail_tag_name" = 'Outside Practice Area'
WHERE "callrail_tag_name" = 'Outside of Practice Area';
--> statement-breakpoint
UPDATE "lsa_callrail_tag_categories"
SET "label" = 'Outside Practice Area'
WHERE "label" = 'Outside of Practice Area';
--> statement-breakpoint
UPDATE "lsa_callrail_tag_categories"
SET "callrail_tag_name" = 'Outside Service Area'
WHERE "callrail_tag_name" = 'Outside of Service Area';
--> statement-breakpoint
UPDATE "lsa_callrail_tag_categories"
SET "label" = 'Outside Service Area'
WHERE "label" = 'Outside of Service Area';
