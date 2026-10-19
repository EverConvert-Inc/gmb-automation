// Pins migration 0055 to exactly what was approved: allow source = 'text'
// on leads, in the NOT VALID then VALIDATE form, and nothing else.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "src", "lib", "db", "migrations");
const sql = readFileSync(join(DIR, "0055_leads_source_text.sql"), "utf8");
const statements = sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);

describe("migration 0055_leads_source_text", () => {
  it("is exactly three statements: drop, re-add NOT VALID, validate", () => {
    expect(statements).toEqual([
      'ALTER TABLE "leads" DROP CONSTRAINT "leads_source_check";',
      `ALTER TABLE "leads" ADD CONSTRAINT "leads_source_check" CHECK ("leads"."source" IN ('call','form','text')) NOT VALID;`,
      'ALTER TABLE "leads" VALIDATE CONSTRAINT "leads_source_check";',
    ]);
  });

  it("touches only leads.leads_source_check — no other table, constraint, column, index or data", () => {
    const tables = [...sql.matchAll(/ALTER TABLE "([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(tables)).toEqual(new Set(["leads"]));
    const constraints = [...sql.matchAll(/CONSTRAINT "([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(constraints)).toEqual(new Set(["leads_source_check"]));
    expect(sql).not.toMatch(/\b(COLUMN|INDEX|CREATE|INSERT|UPDATE|DELETE|TRUNCATE|DROP TABLE|RENAME|GRANT|REVOKE|POLICY)\b/i);
  });

  it("keeps every source the old constraint allowed", () => {
    expect(statements[1]).toContain("IN ('call','form','text')");
  });

  it("is the next journal entry after 0054", () => {
    const journal = JSON.parse(readFileSync(join(DIR, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
    expect(journal.entries.slice(-2).map((e) => e.tag)).toEqual(["0054_portal_events", "0055_leads_source_text"]);
  });

  it("the schema allows text too, so drizzle-kit sees no further drift", () => {
    const schema = readFileSync(join(process.cwd(), "src", "lib", "db", "schema.ts"), "utf8");
    expect(schema).toContain(`sourceCheck: check("leads_source_check", sql\`\${t.source} IN ('call','form','text')\`),`);
  });
});
