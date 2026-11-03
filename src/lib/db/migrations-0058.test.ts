// Pins migration 0058 to what was approved: one new reddit_report_recipients
// table with RLS on, nothing else touched, and every statement safe to
// re-run — it's applied by hand in Supabase first, then again by the
// build's `drizzle-kit migrate`, which has no record of the manual run.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "src", "lib", "db", "migrations");
const sql = readFileSync(join(DIR, "0058_reddit_report_recipients.sql"), "utf8");
const statements = sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);

describe("migration 0058_reddit_report_recipients", () => {
  it("creates only reddit_report_recipients, with RLS enabled and no policies", () => {
    const created = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS "([^"]+)"/g)].map((m) => m[1]);
    expect(created).toEqual(["reddit_report_recipients"]);
    const altered = [...sql.matchAll(/ALTER TABLE "([^"]+)"/g)].map((m) => m[1]);
    expect(altered).toEqual(["reddit_report_recipients"]);
    expect(sql).toMatch(/ALTER TABLE "reddit_report_recipients" ENABLE ROW LEVEL SECURITY/);
    expect(sql).not.toMatch(/FORCE ROW LEVEL SECURITY|CREATE POLICY/i);
    expect(sql).not.toMatch(/\b(DROP|INSERT|UPDATE|DELETE|TRUNCATE|RENAME|GRANT|REVOKE)\b/i);
  });

  it("is idempotent statement by statement", () => {
    for (const s of statements) {
      const ok =
        /^CREATE TABLE IF NOT EXISTS /.test(s) ||
        /^ALTER TABLE "[^"]+" ENABLE ROW LEVEL SECURITY;$/.test(s);
      expect(ok, s.slice(0, 80)).toBe(true);
    }
  });

  it("is the next journal entry after 0057", () => {
    const journal = JSON.parse(readFileSync(join(DIR, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
    const tags = journal.entries.map((e) => e.tag);
    expect(tags[tags.indexOf("0058_reddit_report_recipients") - 1]).toBe("0057_reddit_ads");
  });
});
