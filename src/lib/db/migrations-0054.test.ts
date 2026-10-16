// Pins migration 0054 to exactly what was approved: a new table, RLS on it,
// two indexes. Nothing else — no FK, no DROP, no change to an existing table.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "src", "lib", "db", "migrations");
const sql = readFileSync(join(DIR, "0054_portal_events.sql"), "utf8");
const statements = sql
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

describe("migration 0054_portal_events", () => {
  it("is exactly four statements: create table, enable RLS, two indexes", () => {
    expect(statements).toHaveLength(4);
    expect(statements[0]).toMatch(/^CREATE TABLE IF NOT EXISTS "portal_events" \(/);
    expect(statements[1]).toBe('ALTER TABLE "portal_events" ENABLE ROW LEVEL SECURITY;');
    expect(statements[2]).toBe(
      'CREATE INDEX IF NOT EXISTS "portal_events_firm_created_idx" ON "portal_events" USING btree ("firm_id","created_at");',
    );
    expect(statements[3]).toBe(
      'CREATE INDEX IF NOT EXISTS "portal_events_type_created_idx" ON "portal_events" USING btree ("event_type","created_at");',
    );
  });

  it("names no other table, and has no foreign key, drop, policy or data change", () => {
    const tables = [...sql.matchAll(/(?:TABLE|ON|REFERENCES)\s+(?:IF NOT EXISTS\s+)?"([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(tables)).toEqual(new Set(["portal_events"]));
    expect(sql).not.toMatch(/\b(REFERENCES|FOREIGN KEY|DROP|POLICY|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE)\b/i);
  });

  it("has the approved columns and checks", () => {
    for (const col of [
      '"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL',
      '"created_at" timestamp with time zone DEFAULT now() NOT NULL',
      '"firm_id" uuid NOT NULL',
      '"auth_user_id" uuid NOT NULL',
      '"event_type" text NOT NULL',
      '"lead_id" uuid,',
      `"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL`,
    ]) {
      expect(statements[0]).toContain(col);
    }
    expect(statements[0]).toContain(
      `CHECK ("portal_events"."event_type" IN ('sign_in','page_view','note_saved','date_range_changed','status_filter_used','search_used'))`,
    );
    expect(statements[0]).toContain(
      `CHECK (jsonb_typeof("portal_events"."metadata") = 'object' AND pg_column_size("portal_events"."metadata") <= 1024)`,
    );
  });

  it("is the next entry in the journal", () => {
    const journal = JSON.parse(readFileSync(join(DIR, "meta", "_journal.json"), "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    const last = journal.entries[journal.entries.length - 1];
    expect(last.tag).toBe("0054_portal_events");
    expect(journal.entries[journal.entries.length - 2].tag).toBe("0053_lead_tracker_schema");
  });
});
