ALTER TABLE "ppc_clients" ALTER COLUMN "signed_case_tag" SET DEFAULT 'Signed';
--> statement-breakpoint
UPDATE "ppc_clients" SET "signed_case_tag" = 'Signed' WHERE "signed_case_tag" = 'signed';
