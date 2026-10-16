// Regression: the firm pages' per-firm counts were always 0, because Drizzle
// left the table names off the columns inside a hand-written subquery.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { leadFirmCallrailCompanies, leadFirms, leadFirmTags, leadFirmUsers, leads } from "@/lib/db/schema";
import { countForFirm } from "@/app/admin/firms/_lib/firm-counts";

const db = drizzle({} as never, { schema });

describe("countForFirm", () => {
  it.each([
    ["leads", leads, leads.firmId],
    ["lead_firm_tags", leadFirmTags, leadFirmTags.firmId],
    ["lead_firm_callrail_companies", leadFirmCallrailCompanies, leadFirmCallrailCompanies.firmId],
    ["lead_firm_users", leadFirmUsers, leadFirmUsers.firmId],
  ] as const)("%s: inner table aliased, outer id written as lead_firms.id", (name, table, col) => {
    const q = db.select({ id: leadFirms.id, n: countForFirm(table, col) }).from(leadFirms).toSQL();
    expect(q.sql).toContain(`(select count(*)::int from "${name}" as c where c."firm_id" = "lead_firms"."id")`);
  });

  it("documents the bug: the plain form compiles to an unqualified firm_id = id, i.e. leads.firm_id = leads.id", () => {
    const q = db
      .select({ id: leadFirms.id, n: sql<number>`(select count(*)::int from ${leads} where ${leads.firmId} = ${leadFirms.id})` })
      .from(leadFirms)
      .toSQL();
    expect(q.sql).toContain('(select count(*)::int from "leads" where "firm_id" = "id")');
  });

  it("neither firm page builds a count the old way any more", () => {
    for (const p of [
      ["src", "app", "admin", "firms", "page.tsx"],
      ["src", "app", "admin", "firms", "[id]", "page.tsx"],
    ]) {
      const src = readFileSync(join(process.cwd(), ...p), "utf8");
      expect(src, p.join("/")).not.toMatch(/sql<number>`\(select count\(\*\)/);
      expect(src, p.join("/")).toContain("countForFirm(leads, leads.firmId)");
    }
  });
});
