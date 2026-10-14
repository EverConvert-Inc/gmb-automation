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

import { checkAdmin } from "@/lib/leads/admin-auth";
import { NotAuthorized } from "@/components/leads/not-authorized";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Firms" };

async function countsBy(
  table: typeof leadFirmTags | typeof leadFirmCallrailCompanies | typeof leadFirmUsers,
) {
  const rows = await db
    .select({ firmId: table.firmId, n: sql<number>`count(*)::int` })
    .from(table)
    .groupBy(table.firmId);
  return new Map(rows.map((r) => [r.firmId, r.n]));
}

export default async function AdminFirmsPage() {
  // Staff-only. The middleware gate cannot tell a staff member from a
  // client user, and this page reads across every firm.
  const auth = await checkAdmin();
  if (!auth.ok) return <NotAuthorized />;

  const [firms, tagCounts, companyCounts, userCounts, leadRows, unassignedRow] =
    await Promise.all([
      db.query.leadFirms.findMany({ orderBy: asc(leadFirms.name) }),
      countsBy(leadFirmTags),
      countsBy(leadFirmCallrailCompanies),
      countsBy(leadFirmUsers),
      db
        .select({ firmId: leads.firmId, n: sql<number>`count(*)::int` })
        .from(leads)
        .groupBy(leads.firmId),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(leads)
        .where(isNull(leads.firmId)),
    ]);

  const leadCounts = new Map(
    leadRows
      .filter((r) => r.firmId !== null)
      .map((r) => [r.firmId as string, r.n]),
  );
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
                    const tags = tagCounts.get(f.id) ?? 0;
                    const companies = companyCounts.get(f.id) ?? 0;
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
                            <span className="text-amber-700 dark:text-amber-300">0</span>
                          ) : (
                            tags
                          )}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {companies}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {userCounts.get(f.id) ?? 0}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {leadCounts.get(f.id) ?? 0}
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
