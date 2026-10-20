import Link from "next/link";
import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { checkAdmin } from "@/lib/leads/admin-auth";
import { NotAuthorized } from "@/components/leads/not-authorized";
import { AdminLeadsTable } from "@/components/leads/admin-leads-table";
import { ADMIN_LEAD_LIMIT } from "@/lib/leads/queries-admin";
import { groupByFirm, listHiddenByName } from "./_lib/hidden";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Hidden from clients" };

export default async function AdminHiddenLeadsPage() {
  const auth = await checkAdmin();
  if (!auth.ok) {
    // A timed-out auth check is an outage, not a permissions answer.
    if (auth.status === 503) throw new Error(auth.error);
    return <NotAuthorized />;
  }

  const rows = await listHiddenByName();
  const groups = groupByFirm(rows);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Hidden from clients: no usable name</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Leads the portal would show this month or last, but hides because the name is not a
            person&apos;s name — &ldquo;No Name&rdquo;, a phone number, or a source label. Type a name
            in Edit and the firm sees the lead.
          </p>
        </div>
        <Link href="/admin/leads" className="text-sm hover:underline">
          All leads
        </Link>
      </div>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No leads are hidden by their name.
          </CardContent>
        </Card>
      ) : (
        groups.map((g) => (
          <Card key={g.firmId}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Link href={`/admin/firms/${g.firmId}`} className="hover:underline">
                  {g.firmName}
                </Link>
                <Badge variant="warning">{g.rows.length}</Badge>
              </CardTitle>
              <CardDescription>Hidden from this firm&apos;s portal until a name is typed.</CardDescription>
            </CardHeader>
            <CardContent>
              <AdminLeadsTable rows={g.rows} emptyMessage="" />
            </CardContent>
          </Card>
        ))
      )}
      {rows.length >= ADMIN_LEAD_LIMIT ? (
        <p className="text-xs text-amber-800 dark:text-amber-400">Showing the first {ADMIN_LEAD_LIMIT}.</p>
      ) : null}
    </div>
  );
}
