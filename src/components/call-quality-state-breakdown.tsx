import { StateBreakdownSection } from "@/components/state-breakdown-section";
import { CallQualityClientTable } from "@/components/call-quality-client-table";
import { pickDefaultExpandedState, type StateGroup } from "@/lib/report-grouping";
import type { CallQualityClientRow, CallQualityStateRollup } from "@/lib/queries-call-quality";

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

// Per-channel state breakdown for /call-quality — same collapsible shell
// (StateBreakdownSection) and 6-section structure as /ppc and /lsa, fed
// this channel's own stateGroups. Deliberately per-channel, never combined
// across PPC/LSA/GMB/PMax — the same physical client can carry different
// numbers under each channel (see CallQualityByClientReport.stateGroups'
// comment in queries-call-quality.ts), so a merged state total would
// misattribute which channel that spend/lead volume actually came from.
export function CallQualityStateBreakdown({
  stateGroups,
  showCost,
  showCallViewBreakdown = false,
}: {
  stateGroups: StateGroup<CallQualityClientRow, CallQualityStateRollup>[];
  showCost: boolean;
  showCallViewBreakdown?: boolean;
}) {
  if (stateGroups.length === 0) {
    return (
      <div className="rounded-md border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        No clients linked to CallRail for this channel yet.
      </div>
    );
  }

  // Call Quality's "signed" concept is `real` (tag-based real-call
  // classification), not `signedCases` — same ranking logic as /ppc and
  // /lsa's default-expand, different field name for this rollup.
  const defaultExpandedState = pickDefaultExpandedState(stateGroups, (r) => r.real);

  return (
    <div className="space-y-3">
      {stateGroups.map((group) => {
        const r = group.rollup;
        const kpis = [
          { label: "First-time calls", value: fmtNumber(r.firstTimeCalls) },
          { label: "Signed", value: fmtNumber(r.real) },
          { label: "Junk", value: fmtNumber(r.junk) },
          ...(showCost
            ? [
                { label: "Cost", value: fmtUsdFromMicros(r.costMicros) },
                { label: "Signed CPL", value: fmtUsdOrDash(r.realCostPerRealLead) },
              ]
            : []),
        ];
        return (
          <StateBreakdownSection
            key={group.state}
            state={group.state}
            defaultOpen={group.state === defaultExpandedState}
            kpis={kpis}
          >
            <CallQualityClientTable
              rows={group.clients}
              showCost={showCost}
              showCallViewBreakdown={showCallViewBreakdown}
            />
          </StateBreakdownSection>
        );
      })}
    </div>
  );
}
