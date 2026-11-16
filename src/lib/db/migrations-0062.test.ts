// Pins migration 0062 to what was approved: two nullable columns added to
// ppc_account_health_daily, nothing else touched, and both statements safe
// to re-run — it may be applied by hand in Supabase first, then again by
// the build's `drizzle-kit migrate`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "src", "lib", "db", "migrations");
const sql = readFileSync(join(DIR, "0062_ppc_account_health_junk_actions_day_spend.sql"), "utf8");
const statements = sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);

describe("migration 0062_ppc_account_health_junk_actions_day_spend", () => {
  it("adds exactly the two columns, both nullable with no default", () => {
    expect(statements).toEqual([
      'ALTER TABLE "ppc_account_health_daily" ADD COLUMN IF NOT EXISTS "junk_actions" jsonb;',
      'ALTER TABLE "ppc_account_health_daily" ADD COLUMN IF NOT EXISTS "day_spend_micros" bigint;',
    ]);
    expect(sql).not.toMatch(/NOT NULL|DEFAULT/i);
  });

  it("touches no other table and changes no existing data", () => {
    const tables = new Set([...sql.matchAll(/TABLE "([^"]+)"/g)].map((m) => m[1]));
    expect([...tables]).toEqual(["ppc_account_health_daily"]);
    expect(sql).not.toMatch(/\b(DROP|INSERT|UPDATE|DELETE|TRUNCATE|RENAME|GRANT|REVOKE|CREATE)\b/i);
  });

  it("is the next journal entry after 0061", () => {
    const journal = JSON.parse(readFileSync(join(DIR, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
    const tags = journal.entries.map((e) => e.tag);
    expect(tags[tags.indexOf("0062_ppc_account_health_junk_actions_day_spend") - 1]).toBe("0061_ppc_account_health_daily");
  });
});
