import { sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { leadFirms } from "@/lib/db/schema";

/**
 * `(select count(*) from <table> where <table>.<firm column> = lead_firms.id)`,
 * as a correlated subquery for a select FROM lead_firms.
 *
 * Every column is written with its table on purpose. Drizzle renders column
 * references WITHOUT the table name in a single-table select, so the obvious
 * `sql\`... where ${leads.firmId} = ${leadFirms.id}\`` became
 * `where "firm_id" = "id"` — and inside the subquery Postgres resolves both
 * to the INNER table (leads.firm_id = leads.id), which is never true. Every
 * count was 0. The inner table is aliased and the outer id is written as
 * "lead_firms"."id", so there is nothing for Postgres to resolve wrongly.
 */
export function countForFirm(table: PgTable, firmIdColumn: PgColumn): SQL<number> {
  return sql<number>`(select count(*)::int from ${table} as c where c.${sql.identifier(firmIdColumn.name)} = ${sql.identifier(
    "lead_firms",
  )}.${sql.identifier(leadFirms.id.name)})`;
}
