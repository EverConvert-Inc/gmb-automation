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

// KPI strip + ClientTable for one channel — used by ChannelPage (LSA/GMB,
// each still gets its own page with a KPI strip). PpcPmaxPage renders
// ClientTable directly for its PPC/PMax sub-sections instead of this —
// the combined KPI strip up top is the only KPI summary shown there now.
function ChannelKpiAndTable({
  channel,
  totals,
  clientRows,
}: {
  channel: CallQualityChannel;
  totals: CallQualityByClientReport["summary"][CallQualityChannel];
  clientRows: CallQualityClientRow[];
}) {
  const showCost = channel !== "GMB" && channel !== "PMax";
  const showCallViewBreakdown = channel === "PMax";

  return (
    <>
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
      <ClientTable
        showCost={showCost}
        showCallViewBreakdown={showCallViewBreakdown}
        clientRows={clientRows}
      />
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

// One page per channel (LSA, GMB) — same shape as the web's
// CallQualityChannelSection + CallQualityClientTable. Unlike PPC/LSA's
// PDFs, there's no prior-period delta here — getCallQualityByClientReport
// only returns range totals, no comparison window.
function ChannelPage({
  channel,
  totals,
  clientRows,
  opts,
  generatedAt,
}: {
  channel: CallQualityChannel;
  totals: CallQualityByClientReport["summary"][CallQualityChannel];
  clientRows: CallQualityClientRow[];
  opts: RenderOpts;
  generatedAt: Date;
}) {
  return (
    <Page size="LETTER" style={styles.page}>
      <PageHeader title={channel} opts={opts} generatedAt={generatedAt} />
      <ChannelKpiAndTable channel={channel} totals={totals} clientRows={clientRows} />
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
// out below as client tables only — still genuinely separate lead
// sources, just without their own top-level stats anymore.
function PpcPmaxPage({
  ppcTotals,
  pmaxTotals,
  ppcClientRows,
  pmaxClientRows,
  opts,
  generatedAt,
}: {
  ppcTotals: CallQualityByClientReport["summary"]["PPC"];
  pmaxTotals: CallQualityByClientReport["summary"]["PMax"];
  ppcClientRows: CallQualityClientRow[];
  pmaxClientRows: CallQualityClientRow[];
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
        <ClientTable showCost clientRows={ppcClientRows} showCallViewBreakdown={false} />
      </View>

      <View style={styles.channelDivider}>
        <Text style={styles.channelHeading}>PMax</Text>
        <ClientTable showCost={false} clientRows={pmaxClientRows} showCallViewBreakdown />
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
        ppcClientRows={report.clients.PPC}
        pmaxClientRows={report.clients.PMax}
        opts={opts}
        generatedAt={generatedAt}
      />
      <ChannelPage
        channel="LSA"
        totals={report.summary.LSA}
        clientRows={report.clients.LSA}
        opts={opts}
        generatedAt={generatedAt}
      />
      <ChannelPage
        channel="GMB"
        totals={report.summary.GMB}
        clientRows={report.clients.GMB}
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
