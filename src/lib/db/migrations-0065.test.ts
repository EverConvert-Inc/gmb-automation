// Pins migration 0065 to what was approved: create ppc_ad_standards and
// enable RLS on it (ENABLE, not FORCE, like the other tables). Additive only —
// no other table touched, no data changed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "src", "lib", "db", "migrations");
const sql = readFileSync(join(DIR, "0065_ppc_ad_standards.sql"), "utf8");
const statements = sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);

describe("migration 0065_ppc_ad_standards", () => {
  it("creates the table and enables RLS, nothing else", () => {
    expect(statements).toHaveLength(2);
    expect(statements[0]).toMatch(/^CREATE TABLE IF NOT EXISTS "ppc_ad_standards"/);
    expect(statements[1]).toBe('ALTER TABLE "ppc_ad_standards" ENABLE ROW LEVEL SECURITY;');
  });

  it("touches only ppc_ad_standards and changes no existing data", () => {
    const tables = new Set([...sql.matchAll(/TABLE (?:IF NOT EXISTS )?"([^"]+)"/g)].map((m) => m[1]));
    expect([...tables]).toEqual(["ppc_ad_standards"]);
    expect(sql).not.toMatch(/\b(DROP|INSERT|UPDATE|DELETE|TRUNCATE|RENAME|GRANT|REVOKE)\b/i);
  });

  it("is the next journal entry after 0064", () => {
    const journal = JSON.parse(readFileSync(join(DIR, "meta", "_journal.json"), "utf8")) as {
      entries: { tag: string }[];
    };
    const tags = journal.entries.map((e) => e.tag);
    expect(tags[tags.indexOf("0065_ppc_ad_standards") - 1]).toBe("0064_ppc_ads_conversions_value_channel_type");
  });
});
