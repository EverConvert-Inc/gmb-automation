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

// One page per channel — same shape as the web's CallQualityChannelSection
// + CallQualityClientTable (KPI strip, then a flat per-client table; no
// per-campaign nesting since Call Quality is a rollup, not a campaign
// report). showCost hides Cost/Signed CPL/Ads CPA for GMB (organic, no ad
// spend) and PMax (spend not isolated from the rest of the PPC account
// yet). Unlike PPC/LSA's PDFs, there's no prior-period delta here —
// getCallQualityByClientReport only returns range totals, no comparison
// window.
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
  // Neither GMB (organic) nor PMax (spend not isolated from the rest of
  // the PPC account yet — see queries-call-quality.ts's finalize()) has a
  // meaningful cost figure today.
  const showCost = channel !== "GMB" && channel !== "PMax";
  // PMax-only call_view match reconciliation (see CallrailChannelBucket in
  // callrail.ts) — always-visible columns here since react-pdf has no
  // collapsible equivalent to the web's per-client dropdown
  // (CallQualityClientTable). "Total PMax calls" is deliberately not
  // labeled just "Total calls" — distinct from "First-time" above, since
  // PMax matching is unscoped by first_call.
  const showCallViewBreakdown = channel === "PMax";
  const rows = [...clientRows].sort(
    (a, b) => b.real - a.real || a.clientName.localeCompare(b.clientName),
  );

  return (
    <Page size="LETTER" style={styles.page}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.headerEyebrow}>Cross-channel</Text>
          <Text style={styles.headerTitle}>Call Quality — {channel}</Text>
          <Text style={styles.headerDate}>
            {fmtRangeHeader(opts.from, opts.to)}
          </Text>
        </View>
        <Text style={styles.headerGenerated}>
          Generated {fmtGeneratedAt(generatedAt)} UTC
        </Text>
      </View>

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
    </Page>
  );
}

const CHANNELS: CallQualityChannel[] = ["PPC", "LSA", "GMB", "PMax"];

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
      {CHANNELS.map((channel) => (
        <ChannelPage
          key={channel}
          channel={channel}
          totals={report.summary[channel]}
          clientRows={report.clients[channel]}
          opts={opts}
          generatedAt={generatedAt}
        />
      ))}
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
