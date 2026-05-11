import type { Config } from "drizzle-kit";

// Migrations need a direct Postgres connection (prepared statements aren't
// supported through Supabase's pooled pgbouncer connection in transaction
// mode). Prefer DIRECT_URL when set, fall back to DATABASE_URL — handy for
// local dev where the same URL works for both, and for Vercel deploys where
// we point DATABASE_URL at the pooled URL and DIRECT_URL at the direct one.
export default {
  schema: "./src/lib/db/schema.ts",
  out: "./src/lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
} satisfies Config;
