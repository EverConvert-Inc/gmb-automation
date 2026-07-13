import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { LsaReport } from "./queries-lsa";

// Small duplicate formatters — the web versions live in
// `src/components/lsa-report-table.tsx` (which is `"use client"`) so they
// can't be imported into this server-side render path. Logic is identical.
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

// Lightweight KPI delta vs prior period. Renders absolute delta + a tone
// flag so the PDF can color-code positives/negatives.
function delta(current: number, prior: number): {
  text: string;
  tone: "up" | "down" | "flat";
} {
  if (prior === 0 && current === 0) return { text: "no prior", tone: "flat" };
  const d = current - prior;
  if (d === 0) return { text: "no change", tone: "flat" };
  const sign = d > 0 ? "+" : "";
  return {
    text: `${sign}${fmtNumber(Math.round(d))} vs prior`,
    tone: d > 0 ? "up" : "down",
  };
}

function dollarsDelta(current: bigint, prior: bigint): {
  text: string;
  tone: "up" | "down" | "flat";
} {
  if (current === 0n && prior === 0n) return { text: "no prior", tone: "flat" };
  const d = Number(current - prior) / 1_000_000;
  if (d === 0) return { text: "no change", tone: "flat" };
  const sign = d > 0 ? "+" : "";
  const formatted = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(d);
  return {
    text: `${sign}${formatted} vs prior`,
    tone: d > 0 ? "down" : "up",
  };
}

const BRAND_GREEN = "#22c55e";
const BRAND_DARK = "#0f172a";
const BORDER = "#e2e8f0";
const MUTED = "#64748b";
const RED = "#dc2626";

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
  kpiDelta: {
    fontSize: 7,
    marginTop: 2,
  },
  kpiDeltaUp: { color: BRAND_GREEN },
  kpiDeltaDown: { color: RED },
  kpiDeltaFlat: { color: MUTED },
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
  d,
}: {
  label: string;
  value: string;
  d: { text: string; tone: "up" | "down" | "flat" };
}) {
  const toneStyle =
    d.tone === "up"
      ? styles.kpiDeltaUp
      : d.tone === "down"
        ? styles.kpiDeltaDown
        : styles.kpiDeltaFlat;
  return (
    <View style={styles.kpiBox}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={[styles.kpiDelta, toneStyle]}>{d.text}</Text>
    </View>
  );
}

// Unlike PpcReportDocument (which nests a per-campaign sub-table under
// each client), LsaReport's rows are already client-level totals — there's
// no campaign dimension — so this is a single flat table.
export function LsaReportDocument({
  report,
  opts,
}: {
  report: LsaReport;
  opts: RenderOpts;
}) {
  const generatedAt = opts.generatedAt ?? new Date();
  // report.rows already arrives sorted (signed cases descending) from
  // getLsaReport() — no re-sort needed here.
  const clients = report.rows;

  return (
    <Document
      title={`LSA report ${fmtRangeHeader(opts.from, opts.to)}`}
      author="EverConvert Local Visibility Platform"
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerEyebrow}>Local Services</Text>
            <Text style={styles.headerTitle}>LSA Report</Text>
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
            label="Phone calls"
            value={fmtNumber(report.kpis.phoneCallCount)}
            d={delta(report.kpis.phoneCallCount, report.kpisPrior.phoneCallCount)}
          />
          <KpiBox
            label="Messages"
            value={fmtNumber(report.kpis.messageCount)}
            d={delta(report.kpis.messageCount, report.kpisPrior.messageCount)}
          />
          <KpiBox
            label="Signed"
            value={fmtNumber(report.kpis.signedCases)}
            d={delta(report.kpis.signedCases, report.kpisPrior.signedCases)}
          />
          <KpiBox
            label="Cost"
            value={fmtMicros(report.kpis.costMicros)}
            d={dollarsDelta(report.kpis.costMicros, report.kpisPrior.costMicros)}
          />
        </View>

        {clients.length === 0 ? (
          <View>
            <Text style={{ color: MUTED, fontSize: 10, marginTop: 24 }}>
              No LSA clients have synced data for this period yet.
            </Text>
          </View>
        ) : (
          <View style={styles.table}>
            <View style={styles.tableHeader} fixed>
              <Text style={[styles.cellName, styles.th]}>Client</Text>
              <Text style={[styles.cellNum, styles.th]}>Phone calls</Text>
              <Text style={[styles.cellNum, styles.th]}>Messages</Text>
              <Text style={[styles.cellNum, styles.th]}>Cost</Text>
              <Text style={[styles.cellNum, styles.th]}>Signed</Text>
            </View>
            {clients.map((c) => (
              <View key={c.lsaClientId} style={styles.tableRow}>
                <Text style={[styles.cellName, styles.td]}>
                  {c.lsaClientName}
                </Text>
                <Text style={[styles.cellNum, styles.td]}>
                  {fmtNumber(c.phoneCallCount)}
                </Text>
                <Text style={[styles.cellNum, styles.td]}>
                  {fmtNumber(c.messageCount)}
                </Text>
                <Text style={[styles.cellNum, styles.td]}>
                  {fmtMicros(c.costMicros)}
                </Text>
                <Text style={[styles.cellNum, styles.td]}>
                  {fmtNumber(c.signedCases)}
                </Text>
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
    </Document>
  );
}

// Render the document to a Buffer for use as an email attachment.
export async function renderLsaReportPdf(
  report: LsaReport,
  opts: RenderOpts,
): Promise<Buffer> {
  return renderToBuffer(<LsaReportDocument report={report} opts={opts} />);
}
