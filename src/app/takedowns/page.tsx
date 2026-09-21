import type { Metadata } from "next";
import { TakedownsTable } from "@/components/takedowns-table";
import { Pagination } from "@/components/pagination";
import { listTakedownAlerts } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Takedowns",
};

const PAGE_SIZE = 25;

export default async function TakedownsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  // Only open (non-resolved) alerts — resolved ones (real or false-positive)
  // stay in the DB for the audit trail but are deliberately excluded here.
  const { rows, totalCount } = await listTakedownAlerts({ page, pageSize: PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Takedowns</h1>
        <p className="text-sm text-muted-foreground">
          Reviews confirmed removed by Google across every client — gone from
          the GBP UI by the time they land here. Use &ldquo;Copy
          details&rdquo; to file a reinstatement request, then mark filed /
          resolved to track it.{" "}
          {totalCount > 0 && (
            <>
              {totalCount} open takedown{totalCount === 1 ? "" : "s"}.
            </>
          )}
        </p>
      </div>

      <TakedownsTable rows={rows} />
      <Pagination page={page} totalPages={totalPages} basePath="/takedowns" />
    </div>
  );
}
