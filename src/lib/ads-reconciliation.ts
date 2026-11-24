// Pure reconciliation engine for the Ads Dashboard. Compares a Google Ads
// conversion action's counted conversions against the CallRail-derived source
// metric it is mapped to, so a drift between what Google Ads reports and what
// actually came through CallRail is visible per client. No API or DB access —
// the judgement calls below are unit-tested.
//
// The three source metrics mirror the reconciliation the team does by hand:
//   - First Time Phone Call  vs CallRail first-time calls
//   - Qualified              vs CallRail good/signed leads
//   - Form submission        vs CallRail form submissions

export type ReconSource =
  | "callrail_first_time_calls"
  | "callrail_good_leads"
  | "callrail_form_submissions";

export const RECON_SOURCES: ReadonlyArray<{
  value: ReconSource;
  label: string;
  hint: string;
}> = [
  {
    value: "callrail_first_time_calls",
    label: "CallRail first-time calls",
    hint: "PPC + PMax first-time calls, GMB excluded",
  },
  {
    value: "callrail_good_leads",
    label: "CallRail good leads (signed)",
    hint: "PPC + PMax real/signed rollup, GMB excluded",
  },
  {
    value: "callrail_form_submissions",
    label: "CallRail form submissions",
    hint: "Company-wide form fills, pulled live",
  },
];

const SOURCE_LABELS: Record<ReconSource, string> = Object.fromEntries(
  RECON_SOURCES.map((s) => [s.value, s.label]),
) as Record<ReconSource, string>;

export function reconSourceLabel(s: ReconSource): string {
  return SOURCE_LABELS[s] ?? s;
}

export function isReconSource(s: string): s is ReconSource {
  return s in SOURCE_LABELS;
}

export type ReconMapping = {
  id: string;
  label: string;
  adsConversionActionId: string;
  adsConversionActionName: string;
  source: ReconSource;
  enabled: boolean;
};

export type ReconInputs = {
  // Conversion action id -> conversions counted in the window.
  adsByActionId: Record<string, number>;
  // The CallRail-derived value for each source metric in the window.
  callrail: Record<ReconSource, number>;
};

export type ReconStatus = "match" | "watch" | "mismatch";

export type ReconRow = {
  id: string;
  label: string;
  source: ReconSource;
  adsConversionActionId: string;
  adsConversionActionName: string;
  adsCount: number;
  sourceCount: number;
  // adsCount - sourceCount. Positive = Google Ads counted more than CallRail.
  delta: number;
  // |delta| / max(adsCount, sourceCount); null when both are zero.
  diffPct: number | null;
  status: ReconStatus;
};

export type ReconSummary = {
  mapped: number;
  match: number;
  watch: number;
  mismatch: number;
};

// Classify how far apart two counts are. A single-lead difference is treated
// as noise (attribution lands a day either side, one offline upload lags),
// so the absolute gate comes before the percentage gate — otherwise small
// weekly counts (3 vs 4) would always read as a big miss.
export function classifyDiff(
  adsCount: number,
  sourceCount: number,
): { delta: number; diffPct: number | null; status: ReconStatus } {
  const delta = adsCount - sourceCount;
  const max = Math.max(adsCount, sourceCount);
  if (max === 0) return { delta: 0, diffPct: null, status: "match" };
  const diffPct = Math.abs(delta) / max;
  let status: ReconStatus;
  if (Math.abs(delta) <= 1 || diffPct <= 0.1) status = "match";
  else if (diffPct <= 0.25) status = "watch";
  else status = "mismatch";
  return { delta, diffPct, status };
}

export function reconcile(
  mappings: ReconMapping[],
  inputs: ReconInputs,
): { rows: ReconRow[]; summary: ReconSummary } {
  const rows: ReconRow[] = mappings
    .filter((m) => m.enabled)
    .map((m) => {
      const adsCount = inputs.adsByActionId[m.adsConversionActionId] ?? 0;
      const sourceCount = inputs.callrail[m.source] ?? 0;
      const { delta, diffPct, status } = classifyDiff(adsCount, sourceCount);
      return {
        id: m.id,
        label: m.label,
        source: m.source,
        adsConversionActionId: m.adsConversionActionId,
        adsConversionActionName: m.adsConversionActionName,
        adsCount,
        sourceCount,
        delta,
        diffPct,
        status,
      };
    })
    // Worst mismatches first, then biggest absolute gap.
    .sort((a, b) => {
      const order: Record<ReconStatus, number> = { mismatch: 0, watch: 1, match: 2 };
      return order[a.status] - order[b.status] || Math.abs(b.delta) - Math.abs(a.delta);
    });

  return {
    rows,
    summary: {
      mapped: rows.length,
      match: rows.filter((r) => r.status === "match").length,
      watch: rows.filter((r) => r.status === "watch").length,
      mismatch: rows.filter((r) => r.status === "mismatch").length,
    },
  };
}
