import { SectionCard } from "@/components/ui/section-card";
import { StatTile } from "@/components/ui/stat-tile";
import { CallQualityClientTable } from "@/components/call-quality-client-table";
import type {
  CallQualityChannel,
  CallQualityChannelTotals,
  CallQualityClientRow,
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

// Presentational only — same shape for PPC, LSA, and GMB, just fed
// different data. Not mirrored per-channel since there's no per-provider
// API logic here to keep separate, unlike the tag-category/recipients
// cards.
export function CallQualityChannelSection({
  channel,
  icon,
  totals,
  clientRows,
}: {
  channel: CallQualityChannel;
  icon: React.ReactNode;
  totals: CallQualityChannelTotals;
  clientRows: CallQualityClientRow[];
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

        <CallQualityClientTable rows={clientRows} showCost={showCost} />
      </div>
    </SectionCard>
  );
}
