import type { CallQualityChannelTotals } from "./queries-call-quality";

// PMax calls are pulled entirely out of PPC's own channel bucket, but
// PMax's ad spend is never actually isolated — it stays wherever it
// always was, inside PPC's own costMicros (see CallQualityChannelTotals'
// hasNoAdCostData comment in queries-call-quality.ts). That means PPC's
// "Real cost per real lead" looks worse than reality after PMax
// reclassification: the numerator (cost) never moved, but some of the
// denominator (real leads) did. Recombining real/junk/cost across PPC +
// PMax recovers the exact true effective CPL — not an approximation,
// since PPC's cost was already all-inclusive to begin with.
//
// adsReportedCpa is NOT recomputed — it's Google Ads' own
// conversions-based metric, entirely unrelated to CallRail channel
// classification, so PMax never had any conversions to lose. Reusing
// PPC's own value here is exact, not approximated.
//
// Purely presentational — doesn't touch how real/junk/signedCases are
// computed or stored anywhere. callViewRows* fields are PMax-specific
// diagnostics (call_view match reconciliation) and stay exclusively on
// PMax's own segment, not part of this combined view.
export type CombinedPpcPmaxTotals = {
  firstTimeCalls: number;
  real: number;
  junk: number;
  unclassified: number;
  costMicros: bigint;
  realCostPerRealLead: number | null;
  adsReportedCpa: number | null;
};

export function combinePpcAndPmaxTotals(
  ppc: CallQualityChannelTotals,
  pmax: CallQualityChannelTotals,
): CombinedPpcPmaxTotals {
  const firstTimeCalls = ppc.firstTimeCalls + pmax.firstTimeCalls;
  const real = ppc.real + pmax.real;
  const junk = ppc.junk + pmax.junk;
  const unclassified = ppc.unclassified + pmax.unclassified;
  const costMicros = ppc.costMicros + pmax.costMicros;
  const realCostPerRealLead =
    real > 0 ? Number(costMicros) / 1_000_000 / real : null;

  return {
    firstTimeCalls,
    real,
    junk,
    unclassified,
    costMicros,
    realCostPerRealLead,
    adsReportedCpa: ppc.adsReportedCpa,
  };
}
