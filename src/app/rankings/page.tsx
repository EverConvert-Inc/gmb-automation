import type { Metadata } from "next";
import { RankingsOverviewTable } from "@/components/rankings-overview-table";
import { ScanAllButton } from "@/components/scan-all-button";
import { Pagination } from "@/components/pagination";
import { formatRelativeTime } from "@/lib/utils";
import { getRankingsOverview } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Rankings",
};

const PAGE_SIZE = 25;

export default async function RankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const { rows, totalCount, latestCheckedAt } = await getRankingsOverview(undefined, {
    page,
    pageSize: PAGE_SIZE,
  });
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Rankings</h1>
          <p className="text-sm text-muted-foreground">
            Organic SERP rankings across all clients. Auto-scans every Thursday
            09:00 UTC.{" "}
            {latestCheckedAt && (
              <>
                Latest data {formatRelativeTime(latestCheckedAt)} ·{" "}
              </>
            )}
            {totalCount} keyword{totalCount === 1 ? "" : "s"} tracked
          </p>
        </div>
        <ScanAllButton />
      </div>

      <RankingsOverviewTable rows={rows} />
      <Pagination page={page} totalPages={totalPages} basePath="/rankings" />
    </div>
  );
}
