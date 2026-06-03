CREATE TABLE IF NOT EXISTS "dataforseo_spend_snapshots" (
	"date" date PRIMARY KEY NOT NULL,
	"lifetime_spent_usd" numeric NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
