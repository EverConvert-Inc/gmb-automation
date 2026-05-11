import type { Metadata } from "next";
import { RankingsOverviewTable } from "@/components/rankings-overview-table";
import { ScanAllButton } from "@/components/scan-all-button";
import { formatRelativeTime } from "@/lib/utils";
import { getRankingsOverview } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Rankings",
};

export default async function RankingsPage() {
  const rows = await getRankingsOverview();
  const checkedTimes = rows
    .map((r) => r.lastCheckedAt)
    .filter((t): t is Date => t !== null)
    .map((t) => t.getTime());
  const newestCheck = checkedTimes.length > 0 ? new Date(Math.max(...checkedTimes)) : null;
  const totalKeywords = rows.length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Rankings</h1>
          <p className="text-sm text-muted-foreground">
            Organic SERP rankings across all clients. Auto-scans every Thursday
            09:00 UTC.{" "}
            {newestCheck && (
              <>
                Latest data {formatRelativeTime(newestCheck)} ·{" "}
              </>
            )}
            {totalKeywords} keyword{totalKeywords === 1 ? "" : "s"} tracked
          </p>
        </div>
        <ScanAllButton />
      </div>

      <RankingsOverviewTable rows={rows} />
    </div>
  );
}
