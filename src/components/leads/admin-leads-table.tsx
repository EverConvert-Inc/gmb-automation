import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatEasternDate, formatEasternDateTime } from "@/lib/leads/admin-dates";
import { AdminLeadActions } from "@/components/leads/admin-lead-actions";
import { adminStatusView } from "@/components/leads/admin-status";
import { sourceLabel } from "@/components/leads/source-label";
import type { AdminLeadRow } from "@/lib/leads/queries-admin";

export { SOURCE_LABEL } from "@/components/leads/source-label";

/**
 * Admin-only. Shows the CallRail tracker and the raw parse state alongside
 * the effective values — none of which a firm ever sees.
 */
export function AdminLeadsTable({
  rows,
  emptyMessage,
  selectable = false,
}: {
  rows: AdminLeadRow[];
  emptyMessage: string;
  /** A checkbox per row (name="leadId"), for BulkApproveForm around the table. */
  selectable?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b text-left text-xs uppercase text-muted-foreground">
          <tr>
            {selectable ? (
              <th className="py-2 pr-3 font-medium">
                <span className="sr-only">Select</span>
              </th>
            ) : null}
            <th className="py-2 pr-4 font-medium">Date</th>
            <th className="py-2 pr-4 font-medium">Firm</th>
            <th className="py-2 pr-4 font-medium">Name</th>
            <th className="py-2 pr-4 font-medium">Phone</th>
            <th className="py-2 pr-4 font-medium">Status</th>
            <th className="py-2 pr-4 font-medium">Tag</th>
            <th className="py-2 pr-4 font-medium">Channel</th>
            <th className="py-2 pr-4 font-medium">Signed</th>
            <th className="py-2 pr-4 font-medium">Latest note</th>
            <th className="py-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.id} className="align-top">
              {selectable ? (
                <td className="py-2 pr-3">
                  <input
                    type="checkbox"
                    name="leadId"
                    value={row.id}
                    aria-label={`Select the lead from ${formatEasternDateTime(row.occurredAt)}`}
                    className="h-4 w-4"
                  />
                </td>
              ) : null}
              <td className="whitespace-nowrap py-2 pr-4 text-muted-foreground">
                {formatEasternDateTime(row.occurredAt)}
                <div className="text-xs">
                  {sourceLabel(row.source)}
                  {row.personSuffix !== "p1" ? ` · ${row.personSuffix}` : ""}
                </div>
              </td>
              <td className="py-2 pr-4">
                {row.firmId ? (
                  <Link href={`/admin/firms/${row.firmId}`} className="hover:underline">
                    {row.firmName}
                  </Link>
                ) : (
                  <Badge variant="warning">Unassigned</Badge>
                )}
              </td>
              <td className="py-2 pr-4">
                {row.name ?? <span className="text-muted-foreground">—</span>}
                {/* An admin edit is visible as an edit, not silently merged. */}
                {row.nameParsed && row.name !== row.nameParsed ? (
                  <div className="text-xs text-muted-foreground line-through">
                    {row.nameParsed}
                  </div>
                ) : null}
              </td>
              <td className="whitespace-nowrap py-2 pr-4">
                {row.phone ?? <span className="text-muted-foreground">—</span>}
              </td>
              <td className="py-2 pr-4">
                <div className="flex flex-wrap items-center gap-1">
                  <StatusCell row={row} />
                  {row.statusOverride ? (
                    <span className="text-xs text-muted-foreground">(set by admin)</span>
                  ) : null}
                </div>
              </td>
              <td className="py-2 pr-4 text-xs text-muted-foreground">
                {row.statusTagMatched ?? "—"}
              </td>
              <td className="py-2 pr-4 text-xs text-muted-foreground">
                {row.rawSourceName ?? "—"}
              </td>
              <td className="whitespace-nowrap py-2 pr-4 text-xs text-muted-foreground">
                {formatEasternDate(row.signedAt)}
              </td>
              <td className="py-2 pr-4 text-xs text-muted-foreground">
                {row.latestNote ? (
                  <>
                    <span className="line-clamp-2">{row.latestNote.body}</span>
                    <span className="mt-0.5 block">
                      {row.latestNote.authorKind === "staff" ? "Staff" : "Client"} ·{" "}
                      {formatEasternDate(row.latestNote.createdAt)}
                    </span>
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td className="py-2 align-top">
                <AdminLeadActions lead={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const LABEL_BADGE = { signed: "success", pending: "secondary", opportunity: "info" } as const;

/**
 * The portal's label for the lead (adminStatusView), or — when a
 * rejection-style tag hides it from the client — that tag, neutral, with a
 * note. The Opportunity flag still shows beside Signed or Pending.
 */
function StatusCell({ row }: { row: AdminLeadRow }) {
  const view = adminStatusView(row);
  if (view.kind === "hidden") {
    return (
      <>
        <Badge variant="outline">{view.tag}</Badge>
        <span className="text-xs text-muted-foreground">Hidden from client</span>
      </>
    );
  }
  return (
    <>
      <Badge variant={LABEL_BADGE[view.label]}>{view.text}</Badge>
      {row.isOpportunity && view.label !== "opportunity" ? <Badge variant="outline">Opportunity</Badge> : null}
    </>
  );
}
