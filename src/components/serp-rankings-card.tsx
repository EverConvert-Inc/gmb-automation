import Link from "next/link";
import { AlertTriangle, KeyRound, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { NumericDeltaPill, SparkLine } from "@/components/charts";
import { formatRelativeDate } from "@/lib/utils";
import type { SerpKeywordRollup } from "@/lib/queries";

function renderRank(rank: number | null): string {
  return rank == null ? "—" : `#${rank}`;
}

export function SerpRankingsCard({
  data,
  clientSlug,
}: {
  data: SerpKeywordRollup[];
  clientSlug: string;
}) {
  const activeRows = data.filter((r) => r.isActive);

  if (activeRows.length === 0) {
    return (
      <Card>
        <CardHeader className="border-b border-border/60 pb-4">
          <CardTitle className="flex items-center justify-between text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <Search className="h-4 w-4 text-brand" />
              Search rankings
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="rounded-full bg-brand/10 p-4">
              <KeyRound className="h-7 w-7 text-brand" />
            </div>
            <div className="max-w-md space-y-1.5">
              <p className="text-sm font-medium">No tracked keywords yet</p>
              <p className="text-xs text-muted-foreground">
                Add the keywords you want to rank for and the target pages on
                your site. We&apos;ll check Google every Thursday and surface
                national + geo-targeted ranks here.
              </p>
            </div>
            <Link href={`/clients/${clientSlug}/keywords`}>
              <Button size="sm" variant="outline">
                Manage keywords
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="border-b border-border/60 pb-4">
        <CardTitle className="flex items-center justify-between gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <Search className="h-4 w-4 text-brand" />
            Search rankings
            <InfoTooltip>
              Organic Google ranks for each tracked keyword, pulled weekly via
              DataForSEO. National (US) and geo-targeted by city. Lower is
              better — #1 is the top result.
            </InfoTooltip>
          </span>
          <Link href={`/clients/${clientSlug}/keywords`}>
            <Button size="sm" variant="outline">
              Manage keywords
            </Button>
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-6">
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Keyword</th>
                <th className="px-3 py-2 font-medium">Target</th>
                <th className="px-3 py-2 font-medium text-right">National</th>
                <th className="px-3 py-2 font-medium text-right">Geo</th>
                <th className="px-3 py-2 font-medium">Last checked</th>
                <th className="px-3 py-2 font-medium">Trend</th>
              </tr>
            </thead>
            <tbody>
              {activeRows.map((r) => {
                const nationalDelta = (
                  <NumericDeltaPill
                    current={r.latest?.nationalRank ?? null}
                    prior={r.weekAgo?.nationalRank ?? null}
                    precision={0}
                    invert
                  />
                );
                const geoDelta = (
                  <NumericDeltaPill
                    current={r.latest?.geoRank ?? null}
                    prior={r.weekAgo?.geoRank ?? null}
                    precision={0}
                    invert
                  />
                );
                const sparkValues = r.history.map((h) =>
                  h.rank === null ? null : -h.rank,
                );
                return (
                  <tr key={r.trackedKeywordId} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">{r.keyword}</td>
                    <td
                      className="px-3 py-2 text-muted-foreground"
                      title={r.targetUrl}
                    >
                      <span className="block max-w-[28ch] truncate">
                        {r.targetUrl.replace(/^https?:\/\//, "")}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <div className="flex items-center justify-end gap-1.5">
                        {nationalDelta}
                        <span>{renderRank(r.latest?.nationalRank ?? null)}</span>
                        {r.nationalIsWrongPage && (
                          <span title={`Ranking page: ${r.latest?.nationalUrl}`}>
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.geoCity ? (
                        <>
                          <div className="flex items-center justify-end gap-1.5">
                            {geoDelta}
                            <span>{renderRank(r.latest?.geoRank ?? null)}</span>
                            {r.geoIsWrongPage && (
                              <span title={`Ranking page: ${r.latest?.geoUrl}`}>
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {r.geoCity}
                          </div>
                        </>
                      ) : (
                        <span className="text-xs italic text-muted-foreground">
                          national only
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.latest ? formatRelativeDate(r.latest.checkedAt) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {sparkValues.length >= 2 ? (
                        <SparkLine
                          values={sparkValues}
                          width={120}
                          height={28}
                          className="text-brand"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          building history
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
