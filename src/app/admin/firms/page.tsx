import Link from "next/link";
import type { Metadata } from "next";
import { asc, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  leadFirmCallrailCompanies,
  leadFirmTags,
  leadFirmUsers,
  leadFirms,
  leads,
} from "@/lib/db/schema";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NewFirmForm } from "@/components/leads/new-firm-form";
import { assertRowShape } from "@/lib/leads/row-guard";

import { checkAdmin } from "@/lib/leads/admin-auth";
import { NotAuthorized } from "@/components/leads/not-authorized";

import { countForFirm } from "./_lib/firm-counts";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Firms" };

/**
 * ONE query for every per-firm count, as correlated subqueries, instead of a
 * fan-out of four.
 *
 * This page used to issue six queries concurrently against a pool capped at
 * five (db/client.ts), which guarantees that at least two share a connection
 * and get pipelined. Under that load a response was reaching the wrong
 * query's promise, and because Drizzle maps rows POSITIONALLY —
 * client.unsafe(...).values() then mapResultRow — a crossed result does not
 * error, it renders as believable nonsense: a count of 1 landing in the
 * `name` slot showed a firm called "1" with no slug, marked inactive.
 *
 * Correlated subqueries are the right shape here regardless: the counts are
 * per firm, there is one row per firm, and Postgres plans them as one pass.
 */
function perFirmCounts() {
  return {
    id: leadFirms.id,
    name: leadFirms.name,
    slug: leadFirms.slug,
    isActive: leadFirms.isActive,
    // Table-qualified — see countForFirm for why the plain form counted 0.
    tagCount: countForFirm(leadFirmTags, leadFirmTags.firmId),
    companyCount: countForFirm(leadFirmCallrailCompanies, leadFirmCallrailCompanies.firmId),
    userCount: countForFirm(leadFirmUsers, leadFirmUsers.firmId),
    leadCount: countForFirm(leads, leads.firmId),
  };
}

export default async function AdminFirmsPage() {
  // Staff-only. The middleware gate cannot tell a staff member from a
  // client user, and this page reads across every firm.
  const auth = await checkAdmin();
  if (!auth.ok) {
    // A timed-out auth check is an outage, not a permissions answer: throw so
    // the error boundary says so instead of rendering "Not authorized".
    if (auth.status === 503) throw new Error(auth.error);
    return <NotAuthorized />;
  }

  // SEQUENTIAL, not Promise.all. Two round-trips over this much data cost
  // nothing, and zero concurrent queries means nothing can be pipelined onto
  // a shared connection in the first place.
  const firms = await db
    .select(perFirmCounts())
    .from(leadFirms)
    .orderBy(asc(leadFirms.name));
  assertRowShape("admin/firms: per-firm counts", firms, {
    id: "string",
    name: "string",
    slug: "string",
    isActive: "boolean",
    tagCount: "number",
  });

  const unassignedRow = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(isNull(leads.firmId));
  const unassigned = unassignedRow[0]?.n ?? 0;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Firms</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tenants for the lead tracker. A lead routes to a firm by matching
          one of its tags, or failing that by its CallRail company.
        </p>
      </div>

      {unassigned > 0 ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          {unassigned} lead{unassigned === 1 ? " is" : "s are"} currently
          unassigned. They will route on the next sync once a matching tag or
          company mapping exists.
        </p>
      ) : null}

      <NewFirmForm />

      <Card>
        <CardHeader>
          <CardTitle>All firms</CardTitle>
          <CardDescription>
            A firm with no tags and no company mappings never receives a lead.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {firms.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No firms yet. Add one above.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Firm</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 text-right font-medium">Tags</th>
                    <th className="py-2 pr-4 text-right font-medium">Companies</th>
                    <th className="py-2 pr-4 text-right font-medium">Users</th>
                    <th className="py-2 text-right font-medium">Leads</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {firms.map((f) => {
                    const tags = f.tagCount;
                    const companies = f.companyCount;
                    return (
                      <tr key={f.id}>
                        <td className="py-2 pr-4">
                          <Link
                            href={`/admin/firms/${f.id}`}
                            className="font-medium hover:underline"
                          >
                            {f.name}
                          </Link>
                          <span className="ml-2 font-mono text-xs text-muted-foreground">
                            {f.slug}
                          </span>
                        </td>
                        <td className="py-2 pr-4">
                          {f.isActive ? (
                            <Badge variant="success">Active</Badge>
                          ) : (
                            <Badge variant="outline">Inactive</Badge>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {tags === 0 && companies === 0 ? (
                            <span className="text-amber-800 dark:text-amber-400">0</span>
                          ) : (
                            tags
                          )}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {companies}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {f.userCount}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {f.leadCount}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
