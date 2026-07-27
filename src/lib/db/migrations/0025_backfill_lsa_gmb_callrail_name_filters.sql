-- One-time backfill: give every active LSA client a default GMB tracker
-- filter of ["GMB"] if it doesn't already have one AND its CallRail company
-- has no matching ppc_clients row. Data-driven, not hardcoded to specific
-- clients — this naturally resolves to the LSA-only clients confirmed to
-- carry GMB tracking numbers (1Charlotte, Cowboy Law Group, Workers
-- Compensation ATL, Schuerger & Shunnarah TX, SC Car Accident Lawyers as of
-- writing), while leaving every LSA client that shares a CallRail company
-- with a PPC record untouched — GMB classification for those stays owned
-- by the PPC side (see lsa-sync.ts), so this backfill must never set a
-- non-empty filter there or it would enable a double-count.
--
-- Idempotent — only touches rows where the column is still empty, so a
-- client whose filter was already customized (or already backfilled) is
-- left untouched.
UPDATE "lsa_clients"
SET "gmb_callrail_name_filters" = ARRAY['GMB']::text[]
WHERE "is_active" = true
AND "gmb_callrail_name_filters" = ARRAY[]::text[]
AND "callrail_company_id" IS NOT NULL
AND NOT EXISTS (
	SELECT 1 FROM "ppc_clients"
	WHERE "ppc_clients"."callrail_company_id" = "lsa_clients"."callrail_company_id"
);
