import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import type {
  CallQualityByClientReport,
  CallQualityChannel,
  CallQualityClientRow,
} from "./queries-call-quality";
import { combinePpcAndPmaxTotals } from "./call-quality-combined";
import { STATE_NAMES } from "./report-grouping";

// Small duplicate formatters — the web versions live in
// `src/components/call-quality-client-table.tsx` (which is `"use client"`)
// so they can't be imported into this server-side render path. Logic is
// identical.
const NUMBER_FMT = new Intl.NumberFormat();
function fmtNumber(n: number): string {
  return NUMBER_FMT.format(n);
}
function fmtMicros(microsBig: bigint): string {
  const dollars = Number(microsBig / 10_000n) / 100;
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

function fmtRangeHeader(fromIso: string, toIso: string): string {
  const f = new Date(fromIso + "T00:00:00Z");
  const t = new Date(toIso + "T00:00:00Z");
  const sameYear = f.getUTCFullYear() === t.getUTCFullYear();
  const sameMonth = sameYear && f.getUTCMonth() === t.getUTCMonth();
  const m = (d: Date) =>
    d.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const day = (d: Date) => d.getUTCDate();
  if (sameMonth) {
    return `${m(f)} ${day(f)}–${day(t)}, ${t.getUTCFullYear()}`;
  }
  if (sameYear) {
    return `${m(f)} ${day(f)} – ${m(t)} ${day(t)}, ${t.getUTCFullYear()}`;
  }
  return `${m(f)} ${day(f)}, ${f.getUTCFullYear()} – ${m(t)} ${day(t)}, ${t.getUTCFullYear()}`;
}

function fmtGeneratedAt(d: Date): string {
  return d.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
}

const BRAND_DARK = "#0f172a";
const BORDER = "#e2e8f0";
const MUTED = "#64748b";

const styles = StyleSheet.create({
  page: {
    padding: 32,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: BRAND_DARK,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderBottomWidth: 2,
    borderBottomColor: BRAND_DARK,
    paddingBottom: 8,
    marginBottom: 12,
  },
  headerEyebrow: {
    fontSize: 8,
    color: MUTED,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
  },
  headerDate: {
    fontSize: 11,
    color: MUTED,
    marginTop: 2,
  },
  headerGenerated: {
    fontSize: 8,
    color: MUTED,
  },
  kpiStrip: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  kpiBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 4,
    padding: 8,
  },
  kpiLabel: {
    fontSize: 7,
    color: MUTED,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  kpiValue: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
  },
  kpiSublabel: {
    fontSize: 7,
    color: MUTED,
    marginTop: 2,
  },
  table: {
    marginTop: 8,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingHorizontal: 6,
    paddingVertical: 3,
    backgroundColor: "#f8fafc",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  cellName: {
    flex: 3,
    paddingRight: 6,
  },
  cellNum: {
    flex: 1,
    textAlign: "right",
  },
  th: {
    fontSize: 7,
    color: MUTED,
    letterSpacing: 1,
    textTransform: "uppercase",
    fontFamily: "Helvetica-Bold",
  },
  td: {
    fontSize: 8.5,
  },
  emptyNotice: {
    color: MUTED,
    fontSize: 10,
    marginTop: 24,
  },
  combinedLabel: {
    fontSize: 8,
    color: MUTED,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  stateSection: {
    marginBottom: 14,
  },
  stateHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#e2e8f0",
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  stateTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
  },
  stateKpiText: {
    fontSize: 7.5,
    color: "#334155",
  },
  channelHeading: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginBottom: 8,
  },
  channelDivider: {
    borderTopWidth: 1,
    borderTopColor: BORDER,
    marginTop: 20,
    paddingTop: 20,
  },
  footer: {
    position: "absolute",
    bottom: 16,
    left: 32,
    right: 32,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: MUTED,
  },
});

type RenderOpts = {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  generatedAt?: Date;
};

function KpiBox({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string;
  sublabel?: string;
}) {
  return (
    <View style={styles.kpiBox}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={styles.kpiValue}>{value}</Text>
      {sublabel && <Text style={styles.kpiSublabel}>{sublabel}</Text>}
    </View>
  );
}

// Per-client table for one channel — no KPI strip, no page/header/footer.
// Shared by ChannelKpiAndTable (LSA/GMB, PPC/PMax's own pages if ever
// used standalone again) and PpcPmaxPage's PPC/PMax sub-sections, which
// render only the table (no KPI strip — see PpcPmaxPage). showCost hides
// Cost/Signed CPL/Ads CPA for GMB (organic, no ad spend) and PMax (spend
// not isolated from the rest of the PPC account yet). showCallViewBreakdown
// adds PMax's always-visible call_view reconciliation columns (react-pdf
// has no collapsible equivalent to the web's per-client dropdown). "Total
// PMax calls" is deliberately not labeled just "Total calls" — distinct
// from "First-time" above, since PMax matching is unscoped by first_call.
function ClientTable({
  showCost,
  showCallViewBreakdown,
  clientRows,
}: {
  showCost: boolean;
  showCallViewBreakdown: boolean;
  clientRows: CallQualityClientRow[];
}) {
  const rows = [...clientRows].sort(
    (a, b) => b.real - a.real || a.clientName.localeCompare(b.clientName),
  );

  return (
    <>
      {rows.length === 0 ? (
        <Text style={styles.emptyNotice}>
          No clients linked to CallRail for this channel yet.
        </Text>
      ) : (
        <View style={styles.table}>
          <View style={styles.tableHeader} fixed>
            <Text style={[styles.cellName, styles.th]}>Client</Text>
            <Text style={[styles.cellNum, styles.th]}>First-time</Text>
            <Text style={[styles.cellNum, styles.th]}>Signed</Text>
            <Text style={[styles.cellNum, styles.th]}>Junk</Text>
            {showCost && (
              <>
                <Text style={[styles.cellNum, styles.th]}>Cost</Text>
                <Text style={[styles.cellNum, styles.th]}>Signed CPL</Text>
                <Text style={[styles.cellNum, styles.th]}>Ads CPA</Text>
              </>
            )}
            {showCallViewBreakdown && (
              <>
                <Text style={[styles.cellNum, styles.th]}>Total PMax calls</Text>
                <Text style={[styles.cellNum, styles.th]}>Matched</Text>
                <Text style={[styles.cellNum, styles.th]}>Unmatched</Text>
              </>
            )}
          </View>
          {rows.map((r) => (
            <View key={r.clientId} style={styles.tableRow}>
              <Text style={[styles.cellName, styles.td]}>{r.clientName}</Text>
              <Text style={[styles.cellNum, styles.td]}>
                {fmtNumber(r.firstTimeCalls)}
              </Text>
              <Text style={[styles.cellNum, styles.td]}>
                {fmtNumber(r.real)}
              </Text>
              <Text style={[styles.cellNum, styles.td]}>
                {fmtNumber(r.junk)}
              </Text>
              {showCost && (
                <>
                  <Text style={[styles.cellNum, styles.td]}>
                    {fmtMicros(r.costMicros)}
                  </Text>
                  <Text style={[styles.cellNum, styles.td]}>
                    {fmtUsdOrDash(r.realCostPerRealLead)}
                  </Text>
                  <Text style={[styles.cellNum, styles.td]}>
                    {fmtUsdOrDash(r.adsReportedCpa)}
                  </Text>
                </>
              )}
              {showCallViewBreakdown && (
                <>
                  <Text style={[styles.cellNum, styles.td]}>
                    {fmtNumber(r.callViewRowsTotal)}
                  </Text>
                  <Text style={[styles.cellNum, styles.td]}>
                    {fmtNumber(r.callViewRowsMatched)}
                  </Text>
                  <Text style={[styles.cellNum, styles.td]}>
                    {fmtNumber(r.callViewRowsUnmatched)}
                  </Text>
                </>
              )}
            </View>
          ))}
        </View>
      )}
    </>
  );
}

// KPI strip for one channel — used by ChannelPage (LSA/GMB). PpcPmaxPage
// renders its own combined KPI strip instead of this.
function ChannelKpiStrip({
  totals,
  showCost,
}: {
  totals: CallQualityByClientReport["summary"][CallQualityChannel];
  showCost: boolean;
}) {
  return (
    <View style={styles.kpiStrip}>
      <KpiBox
        label="First-time calls"
        value={fmtNumber(totals.firstTimeCalls)}
      />
      <KpiBox
        label="Signed"
        value={fmtNumber(totals.real)}
        sublabel={`${fmtNumber(totals.junk)} junk, ${fmtNumber(totals.unclassified)} unclassified`}
      />
      <KpiBox
        label="Cost"
        value={showCost ? fmtMicros(totals.costMicros) : "—"}
      />
      <KpiBox
        label="Signed cost / signed lead"
        value={fmtUsdOrDash(totals.realCostPerRealLead)}
        sublabel={`Ads-reported CPA: ${fmtUsdOrDash(totals.adsReportedCpa)}`}
      />
    </View>
  );
}

// State breakdown — PDF-only decision, replaces the old flat ClientTable
// entirely (same as ppc-pdf.tsx/lsa-pdf.tsx), unlike the web UI where it's
// added alongside the existing flat table. State groups stay per-channel,
// never merged — a client's PMax numbers are genuinely different from its
// PPC numbers, even when it's the same client. Reuses ClientTable per state
// group rather than a separate table implementation. react-pdf has no
// collapsible equivalent to the web's/email's sections, so every non-empty
// state renders fully expanded, same as email.
function StateBreakdown({
  stateGroups,
  showCost,
  showCallViewBreakdown,
}: {
  stateGroups: CallQualityByClientReport["stateGroups"][CallQualityChannel];
  showCost: boolean;
  showCallViewBreakdown: boolean;
}) {
  if (stateGroups.length === 0) {
    return (
      <Text style={styles.emptyNotice}>
        No clients linked to CallRail for this channel yet.
      </Text>
    );
  }

  return (
    <>
      {stateGroups.map((group) => {
        const fullName = (STATE_NAMES as Record<string, string>)[group.state];
        const title = fullName ? `${fullName} (${group.state})` : group.state;
        const r = group.rollup;
        const kpiText = [
          `First-time calls ${fmtNumber(r.firstTimeCalls)}`,
          `Signed ${fmtNumber(r.real)}`,
          `Junk ${fmtNumber(r.junk)}`,
          ...(showCost
            ? [
                `Cost ${fmtMicros(r.costMicros)}`,
                `Signed CPL ${fmtUsdOrDash(r.realCostPerRealLead)}`,
              ]
            : []),
        ].join("   ·   ");
        return (
          <View key={group.state} style={styles.stateSection} wrap>
            <View style={styles.stateHeader}>
              <Text style={styles.stateTitle}>{title}</Text>
              <Text style={styles.stateKpiText}>{kpiText}</Text>
            </View>
            <ClientTable
              showCost={showCost}
              showCallViewBreakdown={showCallViewBreakdown}
              clientRows={group.clients}
            />
          </View>
        );
      })}
    </>
  );
}

function PageHeader({
  title,
  opts,
  generatedAt,
}: {
  title: string;
  opts: RenderOpts;
  generatedAt: Date;
}) {
  return (
    <View style={styles.headerRow}>
      <View>
        <Text style={styles.headerEyebrow}>Cross-channel</Text>
        <Text style={styles.headerTitle}>Call Quality — {title}</Text>
        <Text style={styles.headerDate}>
          {fmtRangeHeader(opts.from, opts.to)}
        </Text>
      </View>
      <Text style={styles.headerGenerated}>
        Generated {fmtGeneratedAt(generatedAt)} UTC
      </Text>
    </View>
  );
}

function PageFooter() {
  return (
    <View style={styles.footer} fixed>
      <Text>
        Generated automatically by EverConvert Local Visibility Platform.
      </Text>
      <Text
        render={({ pageNumber, totalPages }) =>
          `Page ${pageNumber} of ${totalPages}`
        }
      />
    </View>
  );
}

// One page per channel (LSA, GMB): KPI strip + state breakdown. Unlike the
// web UI (which keeps the flat per-client table alongside the state
// breakdown), the PDF replaces it entirely — same decision as ppc-pdf.tsx/
// lsa-pdf.tsx. Also unlike PPC/LSA's PDFs, there's no prior-period delta
// here — getCallQualityByClientReport only returns range totals, no
// comparison window.
function ChannelPage({
  channel,
  totals,
  stateGroups,
  opts,
  generatedAt,
}: {
  channel: CallQualityChannel;
  totals: CallQualityByClientReport["summary"][CallQualityChannel];
  stateGroups: CallQualityByClientReport["stateGroups"][CallQualityChannel];
  opts: RenderOpts;
  generatedAt: Date;
}) {
  const showCost = channel !== "GMB" && channel !== "PMax";
  return (
    <Page size="LETTER" style={styles.page}>
      <PageHeader title={channel} opts={opts} generatedAt={generatedAt} />
      <ChannelKpiStrip totals={totals} showCost={showCost} />
      <View style={styles.channelDivider}>
        <StateBreakdown
          stateGroups={stateGroups}
          showCost={showCost}
          showCallViewBreakdown={channel === "PMax"}
        />
      </View>
      <PageFooter />
    </Page>
  );
}

// PMax calls are pulled entirely out of PPC's own numbers, but PMax's ad
// spend was never actually isolated from PPC's — it stays inside PPC's
// costMicros regardless of channel. That means PPC's own "Signed cost /
// signed lead" looks worse than reality once some of its real leads move
// to PMax's bucket while the cost stays behind, even though nothing
// about the true effective CPL actually changed (see
// call-quality-combined.ts). One page: combined total up top is the only
// KPI summary shown (PPC's/PMax's own KPI strips would just restate a
// split that's no longer the headline number), then PPC and PMax broken
// out below as their own state breakdowns — still genuinely separate lead
// sources, just without their own top-level stats anymore.
function PpcPmaxPage({
  ppcTotals,
  pmaxTotals,
  ppcStateGroups,
  pmaxStateGroups,
  opts,
  generatedAt,
}: {
  ppcTotals: CallQualityByClientReport["summary"]["PPC"];
  pmaxTotals: CallQualityByClientReport["summary"]["PMax"];
  ppcStateGroups: CallQualityByClientReport["stateGroups"]["PPC"];
  pmaxStateGroups: CallQualityByClientReport["stateGroups"]["PMax"];
  opts: RenderOpts;
  generatedAt: Date;
}) {
  const combined = combinePpcAndPmaxTotals(ppcTotals, pmaxTotals);

  return (
    <Page size="LETTER" style={styles.page}>
      <PageHeader title="PPC + PMax" opts={opts} generatedAt={generatedAt} />

      <Text style={styles.combinedLabel}>Combined</Text>
      <View style={styles.kpiStrip}>
        <KpiBox label="First-time calls" value={fmtNumber(combined.firstTimeCalls)} />
        <KpiBox
          label="Signed"
          value={fmtNumber(combined.real)}
          sublabel={`${fmtNumber(combined.junk)} junk, ${fmtNumber(combined.unclassified)} unclassified`}
        />
        <KpiBox label="Cost" value={fmtMicros(combined.costMicros)} />
        <KpiBox
          label="Signed cost / signed lead"
          value={fmtUsdOrDash(combined.realCostPerRealLead)}
          sublabel={`Ads-reported CPA: ${fmtUsdOrDash(combined.adsReportedCpa)}`}
        />
      </View>

      <View style={styles.channelDivider}>
        <Text style={styles.channelHeading}>PPC</Text>
        <StateBreakdown
          stateGroups={ppcStateGroups}
          showCost
          showCallViewBreakdown={false}
        />
      </View>

      <View style={styles.channelDivider}>
        <Text style={styles.channelHeading}>PMax</Text>
        <StateBreakdown
          stateGroups={pmaxStateGroups}
          showCost={false}
          showCallViewBreakdown
        />
      </View>

      <PageFooter />
    </Page>
  );
}

export function CallQualityReportDocument({
  report,
  opts,
}: {
  report: CallQualityByClientReport;
  opts: RenderOpts;
}) {
  const generatedAt = opts.generatedAt ?? new Date();
  return (
    <Document
      title={`Call Quality report ${fmtRangeHeader(opts.from, opts.to)}`}
      author="EverConvert Local Visibility Platform"
    >
      <PpcPmaxPage
        ppcTotals={report.summary.PPC}
        pmaxTotals={report.summary.PMax}
        ppcStateGroups={report.stateGroups.PPC}
        pmaxStateGroups={report.stateGroups.PMax}
        opts={opts}
        generatedAt={generatedAt}
      />
      <ChannelPage
        channel="LSA"
        totals={report.summary.LSA}
        stateGroups={report.stateGroups.LSA}
        opts={opts}
        generatedAt={generatedAt}
      />
      <ChannelPage
        channel="GMB"
        totals={report.summary.GMB}
        stateGroups={report.stateGroups.GMB}
        opts={opts}
        generatedAt={generatedAt}
      />
    </Document>
  );
}

// Render the document to a Buffer for use as an email attachment.
export async function renderCallQualityReportPdf(
  report: CallQualityByClientReport,
  opts: RenderOpts,
): Promise<Buffer> {
  return renderToBuffer(
    <CallQualityReportDocument report={report} opts={opts} />,
  );
}
