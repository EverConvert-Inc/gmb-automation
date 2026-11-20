import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { PortalLead } from "@/lib/portal/db";
import { CLIENT_LABEL_TEXT, type ClientLabel } from "@/lib/portal/visibility";
import { formatPortalDate, formatPortalPhone } from "../_components/format";

// The portal's leads list as a PDF. It prints exactly the PortalLead fields
// the leads table already shows — date, name, phone, status, latest note —
// and nothing else, so it can reveal nothing the page does not.

const INK = "#0f172a";
const MUTED = "#64748b";
const BORDER = "#e2e8f0";
const HEAD_BG = "#f8fafc";

// The portal's badge colours, from the green tokens in portal-theme.css (light mode).
const STATUS_STYLE: Record<ClientLabel, { bg: string; fg: string; dot: string }> = {
  signed: { bg: "#ebf7ef", fg: "#15803d", dot: "#15803d" },
  pending: { bg: "#fbf0c9", fg: "#a16207", dot: "#ca8a04" },
};

const COL = { date: "14%", name: "22%", phone: "16%", status: "11%", note: "37%" } as const;

const styles = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 48, paddingHorizontal: 36, fontSize: 9, fontFamily: "Helvetica", color: INK },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 18 },
  firm: { fontSize: 10, color: MUTED, marginBottom: 4 },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold" },
  subtitle: { fontSize: 10, color: MUTED, marginTop: 3 },
  generated: { fontSize: 8, color: MUTED, textAlign: "right" },
  cards: { flexDirection: "row", gap: 10, marginBottom: 16 },
  card: { flex: 1, borderWidth: 1, borderColor: BORDER, borderRadius: 6, paddingVertical: 9, paddingHorizontal: 12 },
  cardLabelRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  cardLabel: { fontSize: 9, color: MUTED },
  cardValue: { fontSize: 18, fontFamily: "Helvetica-Bold", marginTop: 3 },
  notice: { fontSize: 8.5, color: MUTED, marginBottom: 10 },
  table: { borderWidth: 1, borderColor: BORDER, borderRadius: 6 },
  headRow: { flexDirection: "row", backgroundColor: HEAD_BG, borderBottomWidth: 1, borderBottomColor: BORDER },
  headCell: { paddingVertical: 7, paddingHorizontal: 8, fontSize: 7.5, fontFamily: "Helvetica-Bold", color: MUTED, letterSpacing: 0.6, textTransform: "uppercase" },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: BORDER },
  rowLast: { flexDirection: "row" },
  cell: { paddingVertical: 7, paddingHorizontal: 8 },
  name: { fontFamily: "Helvetica-Bold" },
  badge: { alignSelf: "flex-start", borderRadius: 4, paddingVertical: 2, paddingHorizontal: 5, fontSize: 8 },
  noteBy: { fontSize: 7.5, color: MUTED, marginBottom: 1 },
  noteBody: {},
  noteGap: { marginTop: 4 },
  muted: { color: MUTED },
  footer: { position: "absolute", bottom: 22, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: MUTED },
});

export type LeadsPdfInput = {
  firmName: string;
  rangeLabel: string;
  leads: readonly PortalLead[];
  /** The range held more than the portal's lead limit; counts read "at least". */
  reachedLimit: boolean;
  /** Status filter applied, or empty for all. */
  statuses: readonly ClientLabel[];
  generatedAt: Date;
};

function fmtGenerated(d: Date): string {
  return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }) + " ET";
}

function Notes({ lead }: { lead: PortalLead }) {
  if (!lead.firmNote && !lead.staffNote) return <Text style={styles.muted}>—</Text>;
  return (
    <View>
      {lead.staffNote && (
        <View>
          <Text style={styles.noteBy}>From EverConvert · {formatPortalDate(lead.staffNote.date)}</Text>
          <Text style={styles.noteBody}>{lead.staffNote.body}</Text>
        </View>
      )}
      {lead.firmNote && (
        <View style={lead.staffNote ? styles.noteGap : undefined}>
          {lead.staffNote && <Text style={styles.noteBy}>Your note · {formatPortalDate(lead.firmNote.date)}</Text>}
          <Text style={styles.noteBody}>{lead.firmNote.body}</Text>
        </View>
      )}
    </View>
  );
}

export function LeadsPdf({ firmName, rangeLabel, leads, reachedLimit, statuses, generatedAt }: LeadsPdfInput) {
  const counts: Record<ClientLabel, number> = { signed: 0, pending: 0 };
  for (const l of leads) counts[l.status] += 1;
  const shownStatuses: ClientLabel[] = statuses.length ? [...statuses] : ["signed", "pending"];
  const filterNote = statuses.length ? ` · ${statuses.map((s) => CLIENT_LABEL_TEXT[s]).join(" and ")} only` : "";
  const plus = reachedLimit ? "+" : "";

  return (
    <Document title={`${firmName} — Leads — ${rangeLabel}`} author="EverConvert">
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.firm}>{firmName}</Text>
            <Text style={styles.title}>Leads</Text>
            <Text style={styles.subtitle}>
              {rangeLabel} · {leads.length}
              {plus} {leads.length === 1 ? "lead" : "leads"}
              {filterNote}
            </Text>
          </View>
          <Text style={styles.generated}>Generated {fmtGenerated(generatedAt)}</Text>
        </View>

        <View style={styles.cards}>
          {shownStatuses.map((s) => (
            <View key={s} style={styles.card}>
              <View style={styles.cardLabelRow}>
                <View style={[styles.dot, { backgroundColor: STATUS_STYLE[s].dot }]} />
                <Text style={styles.cardLabel}>{CLIENT_LABEL_TEXT[s]}</Text>
              </View>
              <Text style={styles.cardValue}>
                {counts[s]}
                {plus}
              </Text>
            </View>
          ))}
        </View>

        {reachedLimit && (
          <Text style={styles.notice}>
            This range has more leads than one report holds; only the first {leads.length} are listed. Narrow the date range for the rest.
          </Text>
        )}

        <View style={styles.table}>
          <View style={styles.headRow} fixed>
            <Text style={[styles.headCell, { width: COL.date }]}>Date</Text>
            <Text style={[styles.headCell, { width: COL.name }]}>Name</Text>
            <Text style={[styles.headCell, { width: COL.phone }]}>Phone</Text>
            <Text style={[styles.headCell, { width: COL.status }]}>Status</Text>
            <Text style={[styles.headCell, { width: COL.note }]}>Latest note</Text>
          </View>
          {leads.length === 0 && (
            <View style={styles.rowLast}>
              <Text style={[styles.cell, styles.muted]}>No leads for {rangeLabel}.</Text>
            </View>
          )}
          {leads.map((lead, i) => (
            <View key={lead.id} style={i === leads.length - 1 ? styles.rowLast : styles.row} wrap={false}>
              <Text style={[styles.cell, styles.muted, { width: COL.date }]}>{formatPortalDate(lead.date)}</Text>
              <Text style={[styles.cell, styles.name, { width: COL.name }]}>{lead.name ?? "—"}</Text>
              <Text style={[styles.cell, { width: COL.phone }]}>{formatPortalPhone(lead.phone)}</Text>
              <View style={[styles.cell, { width: COL.status }]}>
                <Text style={[styles.badge, { backgroundColor: STATUS_STYLE[lead.status].bg, color: STATUS_STYLE[lead.status].fg }]}>
                  {CLIENT_LABEL_TEXT[lead.status]}
                </Text>
              </View>
              <View style={[styles.cell, { width: COL.note }]}>
                <Notes lead={lead} />
              </View>
            </View>
          ))}
        </View>

        <View style={styles.footer} fixed>
          <Text>
            {firmName} · {rangeLabel}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export function renderLeadsPdf(input: LeadsPdfInput): Promise<Buffer> {
  return renderToBuffer(<LeadsPdf {...input} />);
}

/** "Panchenko Law Firm", "2026-11-01", "2026-11-30" → "panchenko-law-firm-leads-2026-11-01-to-2026-11-30.pdf". */
export function leadsPdfFilename(firmName: string, from: string, to: string): string {
  const slug =
    firmName
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "leads";
  return `${slug}-leads-${from}-to-${to}.pdf`;
}
