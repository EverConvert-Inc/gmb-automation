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
import { AdminLeadsTable } from "@/components/leads/admin-leads-table";
import { listAdminQueue } from "@/lib/leads/queries-admin";
import { QUEUE_REASON_LABELS, type QueueReason } from "@/lib/leads/reconcile";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Lead queue" };

const ORDER: QueueReason[] = [
  "unassigned",
  "parse_failure",
  "possible_duplicate",
  "stale_routing",
];

const BLURB: Record<QueueReason, string> = {
  unassigned:
    "No routing tag matched and the CallRail company is not mapped to a firm. Add a tag or a company mapping and the next sync moves these rows to that firm, keeping their notes.",
  parse_failure:
    "The CallRail note could not be read as a name and a phone. These never reach a firm.",
  possible_duplicate:
    "The same phone already exists for this firm. Flagged at sync time, not blocked — people split from one multi-person note are exempt.",
  stale_routing:
    "Routing no longer sends this lead to this firm, but someone had edited it or written a note, so it was kept rather than removed.",
};

export default async function AdminLeadQueuePage() {
  const auth = await checkAdmin();
  if (!auth.ok) {
    // A timed-out auth check is an outage, not a permissions answer: throw so
    // the error boundary says so instead of rendering "Not authorized".
    if (auth.status === 503) throw new Error(auth.error);
    return <NotAuthorized />;
  }

  const rows = await listAdminQueue();
  const byReason = new Map<QueueReason, typeof rows>();
  for (const row of rows) {
    const list = byReason.get(row.reason) ?? [];
    list.push(row);
    byReason.set(row.reason, list);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Lead queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything needing a human. Not month-scoped on purpose — a lead
            that failed to parse in September is still unresolved today.
          </p>
        </div>
        <Link href="/admin/leads" className="text-sm hover:underline">
          All leads
        </Link>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nothing in the queue.
          </CardContent>
        </Card>
      ) : (
        ORDER.filter((reason) => byReason.has(reason)).map((reason) => {
          const group = byReason.get(reason)!;
          return (
            <Card key={reason}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {QUEUE_REASON_LABELS[reason]}
                  <Badge variant="warning">{group.length}</Badge>
                </CardTitle>
                <CardDescription>{BLURB[reason]}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <AdminLeadsTable rows={group} emptyMessage="" />
                {reason === "parse_failure" ? (
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {group
                      .filter((r) => r.parseError)
                      .slice(0, 10)
                      .map((r) => (
                        <li key={r.id} className="font-mono">
                          {r.callrailId}: {r.parseError}
                        </li>
                      ))}
                  </ul>
                ) : null}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
