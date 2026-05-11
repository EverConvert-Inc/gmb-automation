import { Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { NumericDeltaPill, SparkLine } from "@/components/charts";
import { METRIC_DESCRIPTIONS } from "@/lib/metric-descriptions";
import { formatRelativeDate } from "@/lib/utils";
import type { ScanComparison } from "@/lib/queries";

export function ScanTrendCard({ scans }: { scans: ScanComparison[] }) {
  if (scans.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Scan trend</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No completed scans yet for this location. Run one below to start
            building a trend.
          </p>
        </CardContent>
      </Card>
    );
  }

  // scans come in desc order. For sparklines we want asc-by-time.
  const asc = [...scans].reverse();
  const arpSeries = asc.map((s) => s.arp);
  const solvSeries = asc.map((s) => s.solv);
  const covSeries = asc.map((s) => s.coverage);

  const newest = scans[0];
  const prior = scans[1];

  return (
    <Card>
      <CardHeader className="border-b border-border/60 pb-4">
        <CardTitle className="flex items-center justify-between text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <Activity className="h-4 w-4 text-brand" />
            Scan trend
          </span>
          <span className="text-[11px] font-normal normal-case text-muted-foreground">
            Most recent {scans.length} scan{scans.length === 1 ? "" : "s"} · lower
            ARP and higher SoLV/Coverage are better
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <TrendKpi
            label="ARP"
            info={METRIC_DESCRIPTIONS.arp}
            value={newest.arp !== null ? newest.arp.toFixed(1) : "—"}
            delta={
              <NumericDeltaPill
                current={newest.arp}
                prior={prior?.arp ?? null}
                precision={1}
                invert
              />
            }
            spark={<SparkLine values={arpSeries} width={220} height={36} className="text-foreground" />}
          />
          <TrendKpi
            label="SoLV"
            info={METRIC_DESCRIPTIONS.solv}
            value={`${newest.solv.toFixed(0)}%`}
            delta={
              <NumericDeltaPill
                current={newest.solv}
                prior={prior?.solv ?? null}
                precision={1}
              />
            }
            spark={<SparkLine values={solvSeries} width={220} height={36} className="text-brand" />}
          />
          <TrendKpi
            label="Coverage"
            info={METRIC_DESCRIPTIONS.coverage}
            value={`${newest.coverage.toFixed(0)}%`}
            delta={
              <NumericDeltaPill
                current={newest.coverage}
                prior={prior?.coverage ?? null}
                precision={1}
              />
            }
            spark={<SparkLine values={covSeries} width={220} height={36} className="text-blue-700" />}
          />
        </div>

        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Triggered</th>
                <th className="px-3 py-2 font-medium text-right">
                  <span className="inline-flex items-center gap-1.5">
                    ARP
                    <InfoTooltip>{METRIC_DESCRIPTIONS.arp}</InfoTooltip>
                  </span>
                </th>
                <th className="px-3 py-2 font-medium text-right">
                  <span className="inline-flex items-center gap-1.5">
                    SoLV
                    <InfoTooltip>{METRIC_DESCRIPTIONS.solv}</InfoTooltip>
                  </span>
                </th>
                <th className="px-3 py-2 font-medium text-right">
                  <span className="inline-flex items-center gap-1.5">
                    Coverage
                    <InfoTooltip>{METRIC_DESCRIPTIONS.coverage}</InfoTooltip>
                  </span>
                </th>
                <th className="px-3 py-2 font-medium text-right">Points</th>
              </tr>
            </thead>
            <tbody>
              {scans.map((s, i) => {
                const earlier = scans[i + 1];
                return (
                  <tr
                    key={s.id}
                    className={`border-b last:border-0 ${i === 0 ? "bg-muted/20" : ""}`}
                  >
                    <td className="px-3 py-2" title={s.completedAt?.toLocaleString() ?? ""}>
                      {formatRelativeDate(s.completedAt ?? s.startedAt)}
                      {i === 0 && (
                        <span className="ml-2 rounded-full bg-foreground/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide">
                          latest
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{s.triggeredBy}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <div className="flex items-center justify-end gap-2">
                        <NumericDeltaPill
                          current={s.arp}
                          prior={earlier?.arp ?? null}
                          precision={1}
                          invert
                        />
                        <span>{s.arp !== null ? s.arp.toFixed(1) : "—"}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <div className="flex items-center justify-end gap-2">
                        <NumericDeltaPill
                          current={s.solv}
                          prior={earlier?.solv ?? null}
                          precision={1}
                        />
                        <span>{s.solv.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <div className="flex items-center justify-end gap-2">
                        <NumericDeltaPill
                          current={s.coverage}
                          prior={earlier?.coverage ?? null}
                          precision={1}
                        />
                        <span>{s.coverage.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {s.rankedPoints}/{s.totalPoints}
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

function TrendKpi({
  label,
  value,
  delta,
  spark,
  info,
}: {
  label: string;
  value: string;
  delta: React.ReactNode;
  spark: React.ReactNode;
  info?: string;
}) {
  return (
    <div className="rounded-md border bg-muted/10 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
          <span>{label}</span>
          {info && <InfoTooltip>{info}</InfoTooltip>}
        </span>
        {delta}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1">{spark}</div>
    </div>
  );
}
