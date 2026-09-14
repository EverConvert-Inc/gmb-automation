import type { Metadata } from "next";
import { TakedownsTable } from "@/components/takedowns-table";
import { listTakedownAlerts } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Takedowns",
};

export default async function TakedownsPage() {
  // Only open (non-resolved) alerts — resolved ones (real or false-positive)
  // stay in the DB for the audit trail but are deliberately excluded here.
  const rows = await listTakedownAlerts();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Takedowns</h1>
        <p className="text-sm text-muted-foreground">
          Reviews confirmed removed by Google across every client — gone from
          the GBP UI by the time they land here. Use &ldquo;Copy
          details&rdquo; to file a reinstatement request, then mark filed /
          resolved to track it.{" "}
          {rows.length > 0 && (
            <>
              {rows.length} open takedown{rows.length === 1 ? "" : "s"}.
            </>
          )}
        </p>
      </div>

      <TakedownsTable rows={rows} />
    </div>
  );
}
