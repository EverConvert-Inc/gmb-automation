// Pins migration 0057 to what was approved: four new reddit_* tables with
// RLS on, nothing else touched, and every statement safe to re-run — it's
// applied by hand in Supabase first, then again by the build's
// `drizzle-kit migrate`, which has no record of the manual run (the 0039
// production build failure is what happens otherwise).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "src", "lib", "db", "migrations");
const sql = readFileSync(join(DIR, "0057_reddit_ads.sql"), "utf8");
const statements = sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
const TABLES = ["reddit_clients", "reddit_ad_accounts", "reddit_ads_daily", "reddit_sync_jobs"];

describe("migration 0057_reddit_ads", () => {
  it("creates exactly the four reddit_* tables, each with RLS enabled", () => {
    const created = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS "([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(created)).toEqual(new Set(TABLES));
    const rls = [...sql.matchAll(/ALTER TABLE "([^"]+)" ENABLE ROW LEVEL SECURITY/g)].map((m) => m[1]);
    expect(new Set(rls)).toEqual(new Set(TABLES));
    expect(sql).not.toMatch(/FORCE ROW LEVEL SECURITY|CREATE POLICY/i);
  });

  it("only alters reddit_* tables and writes no data", () => {
    const altered = [...sql.matchAll(/ALTER TABLE "([^"]+)"/g)].map((m) => m[1]);
    expect(altered.every((t) => TABLES.includes(t))).toBe(true);
    // FK actions ("ON DELETE cascade", "ON UPDATE no action") aren't data writes.
    const withoutFkActions = sql.replace(/\bON (DELETE|UPDATE) (cascade|set null|no action)\b/gi, "");
    expect(withoutFkActions).not.toMatch(/\b(DROP|INSERT|UPDATE|DELETE|TRUNCATE|RENAME|GRANT|REVOKE)\b/i);
  });

  it("is idempotent statement by statement", () => {
    for (const s of statements) {
      const ok =
        /^CREATE TABLE IF NOT EXISTS /.test(s) ||
        /^CREATE INDEX IF NOT EXISTS /.test(s) ||
        /^ALTER TABLE "[^"]+" ENABLE ROW LEVEL SECURITY;$/.test(s) ||
        (/^DO \$\$ BEGIN/.test(s) && /WHEN duplicate_object THEN null;/.test(s));
      expect(ok, s.slice(0, 80)).toBe(true);
    }
  });

  it("is the next journal entry after 0056", () => {
    const journal = JSON.parse(readFileSync(join(DIR, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
    const tags = journal.entries.map((e) => e.tag);
    expect(tags[tags.indexOf("0057_reddit_ads") - 1]).toBe("0056_leads_client_approval");
  });
});
