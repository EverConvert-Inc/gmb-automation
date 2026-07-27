-- One-time backfill: give every active PPC client a default GMB tracker
-- filter of ["GMB"] if it doesn't already have one configured. Idempotent —
-- only touches rows where the column is still empty, so a client whose
-- filter was already customized (or already backfilled) is left untouched.
-- This is a data default, not a hardcoded application value — the field
-- stays freely editable via the existing PPC client admin card, same as
-- signedCaseNameFilters.
UPDATE "ppc_clients"
SET "gmb_callrail_name_filters" = ARRAY['GMB']::text[]
WHERE "is_active" = true
AND "gmb_callrail_name_filters" = ARRAY[]::text[];
