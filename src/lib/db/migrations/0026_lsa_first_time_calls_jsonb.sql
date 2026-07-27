-- to_jsonb() on the existing integer values converts each one into an
-- equivalent flat JSON number (e.g. 5 -> 5), which the flat-vs-nested
-- detection in queries-call-quality.ts reads as "all LSA" — zero data
-- loss, no resync required for existing correctness. The plain
-- "SET DATA TYPE jsonb" drizzle-kit generates by default has no USING
-- clause and Postgres rejects it outright (confirmed against a real
-- migration run: "column ... cannot be cast automatically to type jsonb").
ALTER TABLE "lsa_leads_daily" ALTER COLUMN "first_time_calls" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "lsa_leads_daily" ALTER COLUMN "first_time_calls" TYPE jsonb USING to_jsonb("first_time_calls");--> statement-breakpoint
ALTER TABLE "lsa_leads_daily" ALTER COLUMN "first_time_calls" SET DEFAULT '0'::jsonb;