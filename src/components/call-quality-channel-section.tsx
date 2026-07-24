import { SectionCard } from "@/components/ui/section-card";
import { StatTile } from "@/components/ui/stat-tile";
import type {
  CallQualityChannel,
  CallQualityChannelTotals,
  CallQualityPeriodRow,
  CallQualityGranularity,
} from "@/lib/queries-call-quality";

const NUMBER_FMT = new Intl.NumberFormat();
function fmtNumber(n: number): string {
  return NUMBER_FMT.format(n);
}
function fmtUsdFromMicros(micros: bigint): string {
  const dollars = Number(micros / 10_000n) / 100;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(dollars);
}
function fmtUsdOrDash(dollars: number | null): string {
  if (dollars === null) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(dollars);
}
function fmtPeriod(period: string, granularity: CallQualityGranularity): string {
  const d = new Date(period + "T00:00:00Z");
  const label = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return granularity === "week" ? `Week of ${label}` : label;
}

// Presentational only — same shape for PPC, LSA, and GMB, just fed
// different data. Not mirrored per-channel since there's no per-provider
// API logic here to keep separate, unlike the tag-category/recipients
// cards.
export function CallQualityChannelSection({
  channel,
  icon,
  totals,
  rows,
  allLabels,
  granularity,
}: {
  channel: CallQualityChannel;
  icon: React.ReactNode;
  totals: CallQualityChannelTotals;
  rows: CallQualityPeriodRow[];
  allLabels: string[];
  granularity: CallQualityGranularity;
}) {
  const showCost = channel !== "GMB";

  return (
    <SectionCard icon={icon} title={channel} eyebrow="Channel">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatTile
            label="First-time calls"
            value={fmtNumber(totals.firstTimeCalls)}
            tone="brand"
          />
          <StatTile
            label="Real"
            value={fmtNumber(totals.real)}
            sublabel={`${fmtNumber(totals.junk)} junk, ${fmtNumber(totals.unclassified)} unclassified`}
            tone="brand"
          />
          <StatTile
            label="Cost"
            value={showCost ? fmtUsdFromMicros(totals.costMicros) : "—"}
          />
          <StatTile
            label="Real cost / real lead"
            value={fmtUsdOrDash(totals.realCostPerRealLead)}
            sublabel={`Ads-reported CPA: ${fmtUsdOrDash(totals.adsReportedCpa)}`}
          />
        </div>

        {rows.length === 0 ? (
          <div className="rounded-md border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
            No {channel} calls in this range.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">
                    {granularity === "week" ? "Week" : "Day"}
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    First-time calls
                  </th>
                  {allLabels.map((label) => (
                    <th key={label} className="px-3 py-2 text-right font-medium">
                      {label}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-medium">Real</th>
                  <th className="px-3 py-2 text-right font-medium">Junk</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Unclassified
                  </th>
                  {showCost && (
                    <>
                      <th className="px-3 py-2 text-right font-medium">Cost</th>
                      <th className="px-3 py-2 text-right font-medium">
                        Real CPL
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        Ads CPA
                      </th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.period} className="border-b last:border-0">
                    <td className="px-3 py-2 align-middle">
                      {fmtPeriod(r.period, granularity)}
                    </td>
                    <td className="px-3 py-2 text-right align-middle tabular-nums">
                      {fmtNumber(r.firstTimeCalls)}
                    </td>
                    {allLabels.map((label) => (
                      <td
                        key={label}
                        className="px-3 py-2 text-right align-middle tabular-nums"
                      >
                        {fmtNumber(r.tagCounts[label] ?? 0)}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right align-middle tabular-nums">
                      {fmtNumber(r.real)}
                    </td>
                    <td className="px-3 py-2 text-right align-middle tabular-nums">
                      {fmtNumber(r.junk)}
                    </td>
                    <td className="px-3 py-2 text-right align-middle tabular-nums">
                      {fmtNumber(r.unclassified)}
                    </td>
                    {showCost && (
                      <>
                        <td className="px-3 py-2 text-right align-middle tabular-nums">
                          {fmtUsdFromMicros(r.costMicros)}
                        </td>
                        <td className="px-3 py-2 text-right align-middle tabular-nums">
                          {fmtUsdOrDash(r.realCostPerRealLead)}
                        </td>
                        <td className="px-3 py-2 text-right align-middle tabular-nums">
                          {fmtUsdOrDash(r.adsReportedCpa)}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
