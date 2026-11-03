import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import { UNMAPPED_KEY, type RedditClientSpend, type RedditReport } from "./queries-reddit";

// Same look as lsa-pdf.tsx; formatters are duplicated rather than shared,
// as the PPC/LSA PDFs do.
function fmtMicros(micros: bigint): string {
  const dollars = Number(micros / 10_000n) / 100;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(dollars);
}

function fmtRangeHeader(fromIso: string, toIso: string): string {
  const f = new Date(fromIso + "T00:00:00Z");
  const t = new Date(toIso + "T00:00:00Z");
  const sameYear = f.getUTCFullYear() === t.getUTCFullYear();
  const sameMonth = sameYear && f.getUTCMonth() === t.getUTCMonth();
  const m = (d: Date) => d.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const day = (d: Date) => d.getUTCDate();
  if (sameMonth) return `${m(f)} ${day(f)}–${day(t)}, ${t.getUTCFullYear()}`;
  if (sameYear) return `${m(f)} ${day(f)} – ${m(t)} ${day(t)}, ${t.getUTCFullYear()}`;
  return `${m(f)} ${day(f)}, ${f.getUTCFullYear()} – ${m(t)} ${day(t)}, ${t.getUTCFullYear()}`;
}

function fmtDay(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function fmtGeneratedAt(d: Date): string {
  return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" });
}

// Spend is a cost, so up is red and down is green, as in the LSA PDF.
function spendDelta(current: bigint, prior: bigint): { text: string; tone: "up" | "down" | "flat" } {
  if (current === 0n && prior === 0n) return { text: "no prior", tone: "flat" };
  const d = Number(current - prior) / 1_000_000;
  if (d === 0) return { text: "no change", tone: "flat" };
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(d);
  return { text: `${d > 0 ? "+" : ""}${formatted} vs prior`, tone: d > 0 ? "down" : "up" };
}

const DAILY_CLIENT_COLUMNS = 7;

// Columns for the daily table: the top named clients by spend, then one
// "Other clients" column for the rest and one for Unmapped, so the table
// stays readable however many clients there are. Every column sums into
// the Total column unchanged.
export function redditDailyColumns(clients: RedditClientSpend[]): Array<{
  key: string;
  label: string;
  members: RedditClientSpend[];
}> {
  const named = clients.filter((c) => c.key !== UNMAPPED_KEY);
  const unmapped = clients.find((c) => c.key === UNMAPPED_KEY);
  const shown = named.length > DAILY_CLIENT_COLUMNS + 1 ? named.slice(0, DAILY_CLIENT_COLUMNS) : named;
  const rest = named.slice(shown.length);
  return [
    ...shown.map((c) => ({ key: c.key, label: c.name, members: [c] })),
    ...(rest.length ? [{ key: "other", label: `Other clients (${rest.length})`, members: rest }] : []),
    ...(unmapped ? [{ key: UNMAPPED_KEY, label: "Unmapped", members: [unmapped] }] : []),
  ];
}

const BRAND_GREEN = "#22c55e";
const BRAND_DARK = "#0f172a";
const BORDER = "#e2e8f0";
const MUTED = "#64748b";
const RED = "#dc2626";
const AMBER_BG = "#fffbeb";
const AMBER_BORDER = "#fcd34d";

const styles = StyleSheet.create({
  page: { padding: 32, paddingBottom: 40, fontSize: 9, fontFamily: "Helvetica", color: BRAND_DARK },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderBottomWidth: 2,
    borderBottomColor: BRAND_DARK,
    paddingBottom: 8,
    marginBottom: 12,
  },
  headerEyebrow: { fontSize: 8, color: MUTED, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 2 },
  headerTitle: { fontSize: 18, fontFamily: "Helvetica-Bold" },
  headerDate: { fontSize: 11, color: MUTED, marginTop: 2 },
  headerGenerated: { fontSize: 8, color: MUTED },
  kpiStrip: { flexDirection: "row", gap: 8, marginBottom: 12 },
  kpiBox: { flex: 1, borderWidth: 1, borderColor: BORDER, borderRadius: 4, padding: 8 },
  kpiLabel: { fontSize: 7, color: MUTED, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 4 },
  kpiValue: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  kpiSub: { fontSize: 7, marginTop: 2, color: MUTED },
  kpiDeltaUp: { color: BRAND_GREEN },
  kpiDeltaDown: { color: RED },
  notice: {
    borderWidth: 1,
    borderColor: AMBER_BORDER,
    backgroundColor: AMBER_BG,
    borderRadius: 4,
    padding: 6,
    marginBottom: 8,
    fontSize: 8,
  },
  noticeTitle: { fontFamily: "Helvetica-Bold" },
  sectionTitle: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 8, marginBottom: 6 },
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
  tableTotal: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: BRAND_DARK,
    paddingHorizontal: 6,
    paddingVertical: 3,
    fontFamily: "Helvetica-Bold",
  },
  cellName: { flex: 3, paddingRight: 6 },
  cellDate: { flex: 1.1, paddingRight: 4 },
  // Daily-table money columns: left padding keeps right-aligned client
  // names in adjacent headers from running together.
  cellDay: { flex: 1, textAlign: "right", paddingLeft: 8 },
  thDaily: { fontSize: 6.5, color: MUTED, textTransform: "uppercase", fontFamily: "Helvetica-Bold" },
  cellNum: { flex: 1, textAlign: "right" },
  th: { fontSize: 7, color: MUTED, letterSpacing: 0.5, textTransform: "uppercase", fontFamily: "Helvetica-Bold" },
  td: { fontSize: 8.5 },
  tdSmall: { fontSize: 7.5 },
  italicMuted: { color: MUTED, fontFamily: "Helvetica-Oblique" },
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

type RenderOpts = { generatedAt?: Date };

function Footer() {
  return (
    <View style={styles.footer} fixed>
      <Text>Generated automatically by EverConvert Local Visibility Platform.</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

export function RedditReportDocument({ report, opts }: { report: RedditReport; opts: RenderOpts }) {
  const generatedAt = opts.generatedAt ?? new Date();
  const range = fmtRangeHeader(report.from, report.to);
  const dayCount = report.dates.length;
  const avgDaily = dayCount ? report.totalMicros / BigInt(dayCount) : 0n;
  const share = (micros: bigint) =>
    report.totalMicros > 0n ? `${((Number(micros) / Number(report.totalMicros)) * 100).toFixed(1)}%` : "—";
  const d = spendDelta(report.totalMicros, report.priorTotalMicros);
  const columns = redditDailyColumns(report.clients);
  const columnOnDate = (members: RedditClientSpend[], date: string) =>
    members.reduce((s, c) => s + (c.byDate[date] ?? 0n), 0n);

  return (
    <Document title={`Reddit spend report ${range}`} author="EverConvert Local Visibility Platform">
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerEyebrow}>Paid Social</Text>
            <Text style={styles.headerTitle}>Reddit Spend Report</Text>
            <Text style={styles.headerDate}>{range} · Eastern days</Text>
          </View>
          <Text style={styles.headerGenerated}>Generated {fmtGeneratedAt(generatedAt)} ET</Text>
        </View>

        <View style={styles.kpiStrip}>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Spend</Text>
            <Text style={styles.kpiValue}>{fmtMicros(report.totalMicros)}</Text>
            <Text
              style={[
                styles.kpiSub,
                ...(d.tone === "up" ? [styles.kpiDeltaUp] : d.tone === "down" ? [styles.kpiDeltaDown] : []),
              ]}
            >
              {d.text}
            </Text>
          </View>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Avg daily spend</Text>
            <Text style={styles.kpiValue}>{fmtMicros(avgDaily)}</Text>
            <Text style={styles.kpiSub}>{`${dayCount} day${dayCount === 1 ? "" : "s"}`}</Text>
          </View>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Active accounts</Text>
            <Text style={styles.kpiValue}>{String(report.activeAccountCount)}</Text>
            <Text style={styles.kpiSub}>{`${report.unmappedAccountCount} unmapped`}</Text>
          </View>
        </View>

        {report.excludedAccounts.length > 0 && (
          <View style={styles.notice}>
            <Text>
              <Text style={styles.noticeTitle}>Non-USD accounts excluded from totals: </Text>
              {report.excludedAccounts.map((a) => `${a.name} (${a.currency ?? "unknown currency"})`).join(", ")}
            </Text>
          </View>
        )}
        {report.failingAccounts.length > 0 && (
          <View style={styles.notice}>
            <Text>
              <Text style={styles.noticeTitle}>Last sync failed, spend may be incomplete: </Text>
              {report.failingAccounts.map((a) => a.name).join(", ")}
            </Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>Spend by client</Text>
        <View style={styles.tableHeader} fixed>
          <Text style={[styles.cellName, styles.th]}>Client</Text>
          <Text style={[styles.cellNum, styles.th]}>Accounts</Text>
          <Text style={[styles.cellNum, styles.th]}>Spend</Text>
          <Text style={[styles.cellNum, styles.th]}>Avg / day</Text>
          <Text style={[styles.cellNum, styles.th]}>Share</Text>
        </View>
        {report.clients.map((c) => (
          <View key={c.key} style={styles.tableRow} wrap={false}>
            <Text style={[styles.cellName, styles.td, ...(c.key === UNMAPPED_KEY ? [styles.italicMuted] : [])]}>
              {c.name}
            </Text>
            <Text style={[styles.cellNum, styles.td]}>{String(c.accountCount)}</Text>
            <Text style={[styles.cellNum, styles.td]}>{fmtMicros(c.totalMicros)}</Text>
            <Text style={[styles.cellNum, styles.td]}>{fmtMicros(dayCount ? c.totalMicros / BigInt(dayCount) : 0n)}</Text>
            <Text style={[styles.cellNum, styles.td]}>{share(c.totalMicros)}</Text>
          </View>
        ))}
        <View style={styles.tableTotal} wrap={false}>
          <Text style={[styles.cellName, styles.td]}>Total</Text>
          <Text style={[styles.cellNum, styles.td]}>{String(report.clients.reduce((n, c) => n + c.accountCount, 0))}</Text>
          <Text style={[styles.cellNum, styles.td]}>{fmtMicros(report.totalMicros)}</Text>
          <Text style={[styles.cellNum, styles.td]}>{fmtMicros(avgDaily)}</Text>
          <Text style={[styles.cellNum, styles.td]}>{report.totalMicros > 0n ? "100%" : "—"}</Text>
        </View>

        <Footer />
      </Page>

      <Page size="LETTER" orientation="landscape" style={styles.page}>
        <Text style={styles.sectionTitle}>Daily spend by client · {range} · Eastern days</Text>
        <View style={styles.tableHeader} fixed>
          <Text style={[styles.cellDate, styles.thDaily]}>Date</Text>
          {columns.map((c) => (
            <Text key={c.key} style={[styles.cellDay, styles.thDaily]}>
              {c.label}
            </Text>
          ))}
          <Text style={[styles.cellDay, styles.thDaily]}>Total</Text>
        </View>
        {report.dates.map((date) => (
          <View key={date} style={styles.tableRow} wrap={false}>
            <Text style={[styles.cellDate, styles.tdSmall]}>{fmtDay(date)}</Text>
            {columns.map((c) => (
              <Text key={c.key} style={[styles.cellDay, styles.tdSmall]}>
                {fmtMicros(columnOnDate(c.members, date))}
              </Text>
            ))}
            <Text style={[styles.cellDay, styles.tdSmall, { fontFamily: "Helvetica-Bold" }]}>
              {fmtMicros(report.dailyTotals[date] ?? 0n)}
            </Text>
          </View>
        ))}
        <View style={styles.tableTotal} wrap={false}>
          <Text style={[styles.cellDate, styles.tdSmall]}>Total</Text>
          {columns.map((c) => (
            <Text key={c.key} style={[styles.cellDay, styles.tdSmall]}>
              {fmtMicros(c.members.reduce((s, m) => s + m.totalMicros, 0n))}
            </Text>
          ))}
          <Text style={[styles.cellDay, styles.tdSmall]}>{fmtMicros(report.totalMicros)}</Text>
        </View>
        <Footer />
      </Page>
    </Document>
  );
}

// Render the document to a Buffer for use as an email attachment.
export async function renderRedditReportPdf(report: RedditReport, opts: RenderOpts = {}): Promise<Buffer> {
  return renderToBuffer(<RedditReportDocument report={report} opts={opts} />);
}
