// Pins migration 0056 to exactly what was approved: three nullable/defaulted
// client-approval columns on leads, added, and nothing else — no backfill.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "src", "lib", "db", "migrations");
const sql = readFileSync(join(DIR, "0056_leads_client_approval.sql"), "utf8");
const statements = sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);

describe("migration 0056_leads_client_approval", () => {
  it("is exactly three ADD COLUMN statements", () => {
    expect(statements).toEqual([
      'ALTER TABLE "leads" ADD COLUMN "client_approved_at" timestamp with time zone;',
      'ALTER TABLE "leads" ADD COLUMN "client_approved_by" text;',
      'ALTER TABLE "leads" ADD COLUMN "client_approved_negative_tags" text[] DEFAULT ARRAY[]::text[] NOT NULL;',
    ]);
  });

  it("touches only leads, adds only, and writes no data", () => {
    const tables = [...sql.matchAll(/ALTER TABLE "([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(tables)).toEqual(new Set(["leads"]));
    expect(sql).not.toMatch(/\b(DROP|INDEX|CREATE|INSERT|UPDATE|DELETE|TRUNCATE|RENAME|GRANT|REVOKE|POLICY|CONSTRAINT)\b/i);
  });

  it("is the next journal entry after 0055", () => {
    const journal = JSON.parse(readFileSync(join(DIR, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
    const tags = journal.entries.map((e) => e.tag);
    expect(tags[tags.indexOf("0056_leads_client_approval") - 1]).toBe("0055_leads_source_text");
  });

  it("the schema declares the same columns, so drizzle-kit sees no further drift", () => {
    const schema = readFileSync(join(process.cwd(), "src", "lib", "db", "schema.ts"), "utf8");
    expect(schema).toContain('clientApprovedAt: timestamp("client_approved_at", { withTimezone: true }),');
    expect(schema).toContain('clientApprovedBy: text("client_approved_by"),');
    expect(schema).toContain('clientApprovedNegativeTags: text("client_approved_negative_tags").array().notNull().default(sql`ARRAY[]::text[]`),');
  });
});
