import { SectionCard } from "@/components/ui/section-card";
import { StatTile } from "@/components/ui/stat-tile";
import { CallQualityClientTable } from "@/components/call-quality-client-table";
import { combinePpcAndPmaxTotals } from "@/lib/call-quality-combined";
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

// Stat-tile grid + client table, no outer card — shared by
// CallQualityChannelSection (each channel gets its own top-level card) and
// CallQualityPpcPmaxSection (PPC and PMax share one card, this piece
// rendered twice as sub-segments). Extracted so the two call sites can't
// drift from each other.
function ChannelStatsAndTable({
  channel,
  totals,
  clientRows,
}: {
  channel: CallQualityChannel;
  totals: CallQualityChannelTotals;
  clientRows: CallQualityClientRow[];
}) {
  // Neither GMB (organic) nor PMax (spend not isolated from the rest of
  // the PPC account yet — see queries-call-quality.ts's finalize()) has a
  // meaningful cost figure today.
  const showCost = channel !== "GMB" && channel !== "PMax";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile
          label="First-time calls"
          value={fmtNumber(totals.firstTimeCalls)}
          tone="brand"
        />
        <StatTile
          label="Signed"
          value={fmtNumber(totals.real)}
          sublabel={`${fmtNumber(totals.junk)} junk, ${fmtNumber(totals.unclassified)} unclassified`}
          tone="brand"
        />
        <StatTile
          label="Cost"
          value={showCost ? fmtUsdFromMicros(totals.costMicros) : "—"}
        />
        <StatTile
          label="Signed cost / signed lead"
          value={fmtUsdOrDash(totals.realCostPerRealLead)}
          sublabel={`Ads-reported CPA: ${fmtUsdOrDash(totals.adsReportedCpa)}`}
        />
      </div>

      <CallQualityClientTable
        rows={clientRows}
        showCost={showCost}
        showCallViewBreakdown={channel === "PMax"}
      />
    </div>
  );
}

// Presentational only — same shape for LSA and GMB, just fed different
// data. PPC/PMax use CallQualityPpcPmaxSection instead (grouped together,
// see below) — not this component.
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
  return (
    <SectionCard icon={icon} title={channel} eyebrow="Channel">
      <ChannelStatsAndTable channel={channel} totals={totals} clientRows={clientRows} />
    </SectionCard>
  );
}

// PMax calls are pulled entirely out of PPC's own numbers, but PMax's ad
// spend was never actually isolated from PPC's (see
// call-quality-combined.ts) — so PPC's own "Signed cost / signed lead"
// looks worse than reality once some of its real leads move to PMax's
// bucket while the cost stays behind. This groups PPC and PMax into one
// card: a combined total up top (the accurate effective picture), then
// each channel broken out below exactly as it already renders elsewhere
// — same components, same numbers, just nested instead of two separate
// top-level cards.
export function CallQualityPpcPmaxSection({
  icon,
  ppcTotals,
  pmaxTotals,
  ppcClientRows,
  pmaxClientRows,
}: {
  icon: React.ReactNode;
  ppcTotals: CallQualityChannelTotals;
  pmaxTotals: CallQualityChannelTotals;
  ppcClientRows: CallQualityClientRow[];
  pmaxClientRows: CallQualityClientRow[];
}) {
  const combined = combinePpcAndPmaxTotals(ppcTotals, pmaxTotals);

  return (
    <SectionCard icon={icon} title="PPC + PMax" eyebrow="Channel">
      <div className="space-y-6">
        <div>
          <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Combined
          </div>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatTile
              label="First-time calls"
              value={fmtNumber(combined.firstTimeCalls)}
              tone="brand"
            />
            <StatTile
              label="Signed"
              value={fmtNumber(combined.real)}
              sublabel={`${fmtNumber(combined.junk)} junk, ${fmtNumber(combined.unclassified)} unclassified`}
              tone="brand"
            />
            <StatTile label="Cost" value={fmtUsdFromMicros(combined.costMicros)} />
            <StatTile
              label="Signed cost / signed lead"
              value={fmtUsdOrDash(combined.realCostPerRealLead)}
              sublabel={`Ads-reported CPA: ${fmtUsdOrDash(combined.adsReportedCpa)}`}
            />
          </div>
        </div>

        <div className="border-t pt-6">
          <div className="mb-3 text-sm font-semibold">PPC</div>
          <ChannelStatsAndTable channel="PPC" totals={ppcTotals} clientRows={ppcClientRows} />
        </div>

        <div className="border-t pt-6">
          <div className="mb-3 text-sm font-semibold">PMax</div>
          <ChannelStatsAndTable channel="PMax" totals={pmaxTotals} clientRows={pmaxClientRows} />
        </div>
      </div>
    </SectionCard>
  );
}
