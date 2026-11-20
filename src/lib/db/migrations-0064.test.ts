// Pins migration 0064 to what was approved: one NOT NULL column with a safe
// default added to ppc_ads_daily (so existing rows backfill to 0, not fail),
// and one nullable column on ppc_campaigns. Nothing else touched.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "src", "lib", "db", "migrations");
const sql = readFileSync(join(DIR, "0064_ppc_ads_conversions_value_channel_type.sql"), "utf8");
const statements = sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);

describe("migration 0064_ppc_ads_conversions_value_channel_type", () => {
  it("adds exactly the two columns", () => {
    expect(statements).toEqual([
      'ALTER TABLE "ppc_ads_daily" ADD COLUMN "conversions_value" numeric(14, 2) DEFAULT \'0\' NOT NULL;',
      'ALTER TABLE "ppc_campaigns" ADD COLUMN "advertising_channel_type" text;',
    ]);
  });

  it("the NOT NULL column carries a default so existing rows backfill safely", () => {
    const notNull = statements.find((s) => /NOT NULL/i.test(s));
    expect(notNull).toBeDefined();
    expect(notNull).toMatch(/DEFAULT '0'/);
  });

  it("touches only the two ppc tables and changes no existing data", () => {
    const tables = new Set([...sql.matchAll(/TABLE "([^"]+)"/g)].map((m) => m[1]));
    expect([...tables].sort()).toEqual(["ppc_ads_daily", "ppc_campaigns"]);
    expect(sql).not.toMatch(/\b(DROP|INSERT|UPDATE|DELETE|TRUNCATE|RENAME|GRANT|REVOKE|CREATE)\b/i);
  });

  it("is the next journal entry after 0063", () => {
    const journal = JSON.parse(readFileSync(join(DIR, "meta", "_journal.json"), "utf8")) as {
      entries: { tag: string }[];
    };
    const tags = journal.entries.map((e) => e.tag);
    expect(tags[tags.indexOf("0064_ppc_ads_conversions_value_channel_type") - 1]).toBe(
      "0063_whatsapp_inbox",
    );
  });
});
