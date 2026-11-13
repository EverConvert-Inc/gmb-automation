// Pins migration 0061 to what was approved: one new table
// (ppc_account_health_daily) with RLS on, nothing else
// touched, and every statement safe to re-run — it may be applied by hand
// in Supabase first, then again by the build's `drizzle-kit migrate`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "src", "lib", "db", "migrations");
const sql = readFileSync(join(DIR, "0061_ppc_account_health_daily.sql"), "utf8");
const statements = sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
const TABLES = ["ppc_account_health_daily"];

describe("migration 0061_ppc_account_health_daily", () => {
  it("creates only the new table, with RLS enabled and no policies", () => {
    const created = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS "([^"]+)"/g)].map((m) => m[1]);
    expect(created).toEqual(TABLES);
    const altered = new Set([...sql.matchAll(/ALTER TABLE "([^"]+)"/g)].map((m) => m[1]));
    expect([...altered].sort()).toEqual(TABLES);
    for (const t of TABLES) {
      expect(sql).toContain(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`);
    }
    expect(sql).not.toMatch(/FORCE ROW LEVEL SECURITY|CREATE POLICY/i);
    expect(sql).not.toMatch(/\b(DROP|INSERT|UPDATE|DELETE|TRUNCATE|RENAME|GRANT|REVOKE)\b(?! no action)(?! cascade)/);
  });

  it("is idempotent statement by statement", () => {
    for (const s of statements) {
      const ok =
        /^CREATE TABLE IF NOT EXISTS /.test(s) ||
        /^CREATE INDEX IF NOT EXISTS /.test(s) ||
        /^ALTER TABLE "[^"]+" ENABLE ROW LEVEL SECURITY;$/.test(s) ||
        (/^DO \$\$ BEGIN/.test(s) && /WHEN duplicate_object THEN null/.test(s));
      expect(ok, s.slice(0, 80)).toBe(true);
    }
  });

  it("only references ppc_clients", () => {
    const refs = [...sql.matchAll(/REFERENCES "public"\."([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(refs)).toEqual(new Set(["ppc_clients"]));
  });

  it("is the next journal entry after 0060", () => {
    const journal = JSON.parse(readFileSync(join(DIR, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
    const tags = journal.entries.map((e) => e.tag);
    expect(tags[tags.indexOf("0061_ppc_account_health_daily") - 1]).toBe("0060_ppc_search_campaigns_daily");
  });
});
