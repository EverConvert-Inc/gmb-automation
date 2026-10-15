import Link from "next/link";
import type { Metadata } from "next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { checkAdmin } from "@/lib/leads/admin-auth";
import { NotAuthorized } from "@/components/leads/not-authorized";
import { AdminLeadsFilters } from "@/components/leads/admin-leads-filters";
import { AdminLeadsTable } from "@/components/leads/admin-leads-table";
import {
  currentMonthKeyEastern,
  formatMonthKey,
  isMonthKey,
  recentMonthKeys,
} from "@/lib/leads/admin-dates";
import {
  ADMIN_LEAD_LIMIT,
  countAdminQueue,
  listAdminLeads,
  listFirmOptions,
} from "@/lib/leads/queries-admin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Leads" };

export default async function AdminLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; firm?: string }>;
}) {
  // Staff-only. The middleware gate cannot tell a staff member from a client
  // user, and this page reads across every firm.
  const auth = await checkAdmin();
  if (!auth.ok) return <NotAuthorized />;

  const { month, firm } = await searchParams;
  // Validated rather than trusted: an unparsed month would reach the date
  // arithmetic straight from the query string.
  const monthKey = isMonthKey(month) ? month : currentMonthKeyEastern();
  const firmFilter = firm ?? "";

  // SEQUENTIAL, same reason as /admin/firms: concurrent queries on a pool of
  // five are what let a response reach the wrong query's promise.
  const firms = await listFirmOptions();
  const rows = await listAdminLeads({
    monthKey,
    firmId: firmFilter === "unassigned" ? null : firmFilter || undefined,
  });
  const queueCount = await countAdminQueue();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every firm&apos;s leads. The channel, the matched tag and the raw
            parse state are admin-only and never reach a firm.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/firms" className="text-sm hover:underline">
            Firms
          </Link>
          <Link
            href="/admin/leads/queue"
            className="flex items-center gap-2 text-sm hover:underline"
          >
            Queue
            {queueCount > 0 ? (
              <Badge variant="warning">{queueCount}</Badge>
            ) : null}
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{formatMonthKey(monthKey)}</CardTitle>
          <CardDescription>
            Filtered on when the lead arrived, in Eastern time. A signed
            lead&apos;s own signed date is its own column.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <AdminLeadsFilters
            firms={firms}
            months={recentMonthKeys(13)}
            monthKey={monthKey}
            firmFilter={firmFilter}
          />
          <AdminLeadsTable
            rows={rows}
            emptyMessage="No leads for this month and filter."
          />
          {rows.length >= ADMIN_LEAD_LIMIT ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Showing the first {ADMIN_LEAD_LIMIT}. Narrow by firm to see the
              rest.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
