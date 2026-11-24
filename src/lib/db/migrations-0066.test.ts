// Pins migration 0066 to what was approved: create ppc_reconciliation_mappings,
// enable RLS, add its FK to ppc_clients and the client index — nothing else.
// Additive only: no existing table touched, no data changed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "src", "lib", "db", "migrations");
const sql = readFileSync(join(DIR, "0066_ppc_reconciliation_mappings.sql"), "utf8");
const statements = sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);

describe("migration 0066_ppc_reconciliation_mappings", () => {
  it("creates the table, enables RLS, adds the FK and the client index", () => {
    expect(statements).toHaveLength(4);
    expect(statements[0]).toMatch(/^CREATE TABLE IF NOT EXISTS "ppc_reconciliation_mappings"/);
    expect(statements[1]).toBe('ALTER TABLE "ppc_reconciliation_mappings" ENABLE ROW LEVEL SECURITY;');
    expect(statements[2]).toMatch(/ADD CONSTRAINT .* FOREIGN KEY \("ppc_client_id"\) REFERENCES "public"\."ppc_clients"/);
    expect(statements[3]).toMatch(/^CREATE INDEX IF NOT EXISTS "ppc_reconciliation_mappings_client_idx"/);
  });

  it("only creates the one new table and changes no existing data", () => {
    const created = [...sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"([^"]+)"/g)].map((m) => m[1]);
    expect(created).toEqual(["ppc_reconciliation_mappings"]);
    // Strip the FK's referential-action clauses first — "ON DELETE cascade" /
    // "ON UPDATE no action" are not data mutations, they're constraint config.
    const withoutFkActions = sql.replace(/ON (?:DELETE|UPDATE) (?:cascade|no action|restrict|set null|set default)/gi, "");
    expect(withoutFkActions).not.toMatch(/\b(DROP|INSERT|UPDATE|DELETE|TRUNCATE|RENAME|GRANT|REVOKE)\b/i);
  });

  it("is the next journal entry after 0065", () => {
    const journal = JSON.parse(readFileSync(join(DIR, "meta", "_journal.json"), "utf8")) as {
      entries: { tag: string }[];
    };
    const tags = journal.entries.map((e) => e.tag);
    expect(tags[tags.indexOf("0066_ppc_reconciliation_mappings") - 1]).toBe("0065_ppc_ad_standards");
  });
});
