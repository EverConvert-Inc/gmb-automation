import type { Metadata } from "next";
import { TakedownsTable } from "@/components/takedowns-table";
import { listTakedownAlerts } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Takedowns",
};

export default async function TakedownsPage() {
  const rows = await listTakedownAlerts();
  const openCount = rows.filter((r) => r.status !== "resolved").length;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Takedowns</h1>
        <p className="text-sm text-muted-foreground">
          Reviews confirmed removed by Google across every client — gone from
          the GBP UI by the time they land here. Use &ldquo;Copy
          details&rdquo; to file a reinstatement request, then mark filed /
          resolved to track it.{" "}
          {openCount > 0 && (
            <>
              {openCount} open takedown{openCount === 1 ? "" : "s"}.
            </>
          )}
        </p>
      </div>

      <TakedownsTable rows={rows} />
    </div>
  );
}
