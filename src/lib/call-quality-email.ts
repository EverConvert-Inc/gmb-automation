import { Resend } from "resend";
import { asc } from "drizzle-orm";
import { db } from "./db/client";
import { callQualityReportRecipients } from "./db/schema";
import {
  getCallQualityByClientReport,
  type CallQualityByClientReport,
  type CallQualityChannel,
  type CallQualityChannelTotals,
} from "./queries-call-quality";
import { renderCallQualityReportPdf } from "./call-quality-pdf";
import { combinePpcAndPmaxTotals } from "./call-quality-combined";

const DEFAULT_APP_URL = "https://gmb-automation.vercel.app";
const CHANNELS: CallQualityChannel[] = ["PPC", "LSA", "GMB", "PMax"];

type SendOpts = {
  from: string; // YYYY-MM-DD, start of report window
  to: string; // YYYY-MM-DD, end of report window
  dryRun?: boolean;
};

type SendResult =
  | { sent: number; messageId: string | null; recipients: string[] }
  | { sent: 0; reason: string }
  | { sent: 0; dryRun: true; pdf: Buffer; recipients: string[] };

// Pull the recipient list from the DB (managed in the /settings page). The
// uniqueness constraint on `call_quality_report_recipients.email` plus the
// API's lowercase normalization mean we don't need to dedup here.
async function loadRecipients(): Promise<string[]> {
  const rows = await db.query.callQualityReportRecipients.findMany({
    orderBy: asc(callQualityReportRecipients.email),
    columns: { email: true },
  });
  return rows.map((r) => r.email);
}

const NUMBER_FMT = new Intl.NumberFormat();
function fmtNumber(n: number): string {
  return NUMBER_FMT.format(n);
}
function fmtMicros(microsBig: bigint): string {
  const dollars = Number(microsBig / 10_000n) / 100;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(dollars);
}

function fmtRange(fromIso: string, toIso: string): string {
  const f = new Date(fromIso + "T00:00:00Z");
  const t = new Date(toIso + "T00:00:00Z");
  const sameMonth =
    f.getUTCFullYear() === t.getUTCFullYear() &&
    f.getUTCMonth() === t.getUTCMonth();
  const m = (d: Date) =>
    d.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  if (sameMonth) {
    return `${m(f)} ${f.getUTCDate()}–${t.getUTCDate()}, ${t.getUTCFullYear()}`;
  }
  return `${m(f)} ${f.getUTCDate()} – ${m(t)} ${t.getUTCDate()}, ${t.getUTCFullYear()}`;
}

function fmtSubject(fromIso: string, toIso: string): string {
  const f = new Date(fromIso + "T00:00:00Z");
  const t = new Date(toIso + "T00:00:00Z");
  const sameMonth =
    f.getUTCFullYear() === t.getUTCFullYear() &&
    f.getUTCMonth() === t.getUTCMonth();
  const m = (d: Date) =>
    d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  if (sameMonth) {
    return `Call Quality report — ${m(f)} ${f.getUTCDate()}–${t.getUTCDate()}, ${t.getUTCFullYear()}`;
  }
  return `Call Quality report — ${m(f)} ${f.getUTCDate()} – ${m(t)} ${t.getUTCDate()}, ${t.getUTCFullYear()}`;
}

// One row per channel — Signed/Junk plus first-time calls (Unclassified
// is tracked in the data but not shown here — low value at this
// aggregated level), since (unlike PPC/LSA) there's no single unified
// KPI set across PPC/LSA/GMB/PMax. Full per-client breakdown is in the
// attached PDF. `bold` marks the combined "PPC + PMax" row — PPC and
// PMax no longer get their own rows here (see call-quality-combined.ts;
// same simplification as the web view and PDF, which dropped their
// individual KPI blocks too).
function channelRow({
  label,
  firstTimeCalls,
  real,
  junk,
  cost,
  bold = false,
}: {
  label: string;
  firstTimeCalls: number;
  real: number;
  junk: number;
  cost: string;
  bold?: boolean;
}): string {
  const labelStyle = `padding:6px 4px;font-size:13px;font-weight:${bold ? 700 : 600};color:#0f172a;`;
  const cellStyle = "padding:6px 4px;font-size:13px;text-align:right;color:#334155;";
  return `
      <tr${bold ? ` style="background:#f8fafc;"` : ""}>
        <td style="${labelStyle}">${label}</td>
        <td style="${cellStyle}">${fmtNumber(firstTimeCalls)}</td>
        <td style="${cellStyle}">${fmtNumber(real)}</td>
        <td style="${cellStyle}">${fmtNumber(junk)}</td>
        <td style="${cellStyle}">${cost}</td>
      </tr>`;
}

// Whole-report call_view reconciliation, PMax only (see
// CallrailChannelBucket in callrail.ts). Only shown when nonzero — a
// quiet period shouldn't add a noise line every day. Attached to the
// combined "PPC + PMax" row rather than a PMax-specific one, since PMax
// no longer gets its own row here. Full per-client detail is in the
// attached PDF/web dropdown; this is just a flag.
function pmaxUnmatchedNoteHtml(pmax: CallQualityChannelTotals): string {
  if (pmax.callViewRowsUnmatched <= 0) return "";
  return `
      <tr>
        <td colspan="5" style="padding:0 4px 6px;font-size:11px;color:#b45309;">
          ⚠ ${fmtNumber(pmax.callViewRowsUnmatched)} of ${fmtNumber(pmax.callViewRowsTotal)} PMax calls (per Google Ads' call_view) had no matching CallRail record this period.
        </td>
      </tr>`;
}

// Inline-styled HTML so it renders consistently across mail clients
// (Gmail strips <style> blocks but respects inline `style=` attributes).
// PMax calls are pulled entirely out of PPC's own numbers, but PPC's
// cost was never actually split — so a bolded "PPC + PMax" combined row
// (the accurate effective picture, see call-quality-combined.ts) is the
// only PPC/PMax row shown, ahead of LSA and GMB.
function renderEmailHtml({
  report,
  range,
  dashboardUrl,
}: {
  report: CallQualityByClientReport;
  range: string;
  dashboardUrl: string;
}): string {
  const { PPC: ppc, PMax: pmax, LSA: lsa, GMB: gmb } = report.summary;
  const combined = combinePpcAndPmaxTotals(ppc, pmax);

  const channelRows = [
    channelRow({
      label: "PPC + PMax",
      firstTimeCalls: combined.firstTimeCalls,
      real: combined.real,
      junk: combined.junk,
      cost: fmtMicros(combined.costMicros),
      bold: true,
    }) + pmaxUnmatchedNoteHtml(pmax),
    channelRow({
      label: "LSA",
      firstTimeCalls: lsa.firstTimeCalls,
      real: lsa.real,
      junk: lsa.junk,
      cost: fmtMicros(lsa.costMicros),
    }),
    channelRow({
      label: "GMB",
      firstTimeCalls: gmb.firstTimeCalls,
      real: gmb.real,
      junk: gmb.junk,
      cost: "—",
    }),
  ].join("");

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;">
      <tr>
        <td style="padding:24px 24px 8px;">
          <div style="font-size:10px;font-weight:500;letter-spacing:1.5px;text-transform:uppercase;color:#64748b;">Cross-channel</div>
          <h1 style="margin:4px 0 4px;font-size:22px;font-weight:700;color:#0f172a;">Call Quality report</h1>
          <p style="margin:0;font-size:14px;color:#64748b;">${range}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 20px 8px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <thead>
              <tr>
                <th align="left" style="padding:6px 4px;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#64748b;border-bottom:1px solid #e2e8f0;">Channel</th>
                <th align="right" style="padding:6px 4px;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#64748b;border-bottom:1px solid #e2e8f0;">First-time</th>
                <th align="right" style="padding:6px 4px;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#64748b;border-bottom:1px solid #e2e8f0;">Signed</th>
                <th align="right" style="padding:6px 4px;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#64748b;border-bottom:1px solid #e2e8f0;">Junk</th>
                <th align="right" style="padding:6px 4px;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#64748b;border-bottom:1px solid #e2e8f0;">Cost</th>
              </tr>
            </thead>
            <tbody>${channelRows}</tbody>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 24px 8px;">
          <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#334155;">
            Full per-client breakdown across PPC, LSA, GMB, and PMax is attached as a PDF.
          </p>
          <a href="${dashboardUrl}" style="display:inline-block;padding:10px 18px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500;">View interactive dashboard &rarr;</a>
        </td>
      </tr>
      <tr>
        <td style="padding:24px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.5;">
            Generated automatically by EverConvert Local Visibility Platform.<br/>
            Manage who receives this report at
            <a href="${dashboardUrl.replace(/\/call-quality$/, "")}/settings" style="color:#64748b;">/settings</a>.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function channelTextLine({
  label,
  firstTimeCalls,
  real,
  junk,
  cost,
}: {
  label: string;
  firstTimeCalls: number;
  real: number;
  junk: number;
  cost: string;
}): string {
  return `${label.padEnd(11)} first-time ${fmtNumber(firstTimeCalls)}, signed ${fmtNumber(real)}, junk ${fmtNumber(junk)}, cost ${cost}`;
}

// Plain-text fallback for email clients that don't render HTML (and
// improves deliverability — Gmail dings senders who only ship HTML).
// Same combined-only "PPC + PMax" row as renderEmailHtml.
function renderEmailText({
  report,
  range,
  dashboardUrl,
}: {
  report: CallQualityByClientReport;
  range: string;
  dashboardUrl: string;
}): string {
  const { PPC: ppc, PMax: pmax, LSA: lsa, GMB: gmb } = report.summary;
  const combined = combinePpcAndPmaxTotals(ppc, pmax);

  const lines = [
    channelTextLine({
      label: "PPC + PMax",
      firstTimeCalls: combined.firstTimeCalls,
      real: combined.real,
      junk: combined.junk,
      cost: fmtMicros(combined.costMicros),
    }),
    // Same nonzero-only gate as renderEmailHtml's pmaxUnmatchedNoteHtml —
    // PMax no longer has its own row here, so this stays attached to the
    // combined row instead.
    ...(pmax.callViewRowsUnmatched > 0
      ? [
          `      ⚠ ${fmtNumber(pmax.callViewRowsUnmatched)} of ${fmtNumber(pmax.callViewRowsTotal)} PMax calls (per Google Ads' call_view) had no matching CallRail record this period.`,
        ]
      : []),
    channelTextLine({
      label: "LSA",
      firstTimeCalls: lsa.firstTimeCalls,
      real: lsa.real,
      junk: lsa.junk,
      cost: fmtMicros(lsa.costMicros),
    }),
    channelTextLine({
      label: "GMB",
      firstTimeCalls: gmb.firstTimeCalls,
      real: gmb.real,
      junk: gmb.junk,
      cost: "—",
    }),
  ];
  return [
    `Call Quality report — ${range}`,
    ``,
    ...lines,
    ``,
    `Full per-client breakdown across PPC, LSA, GMB, and PMax is attached as a PDF.`,
    ``,
    `Open the interactive dashboard:`,
    dashboardUrl,
    ``,
    `— EverConvert Local Visibility Platform`,
  ].join("\n");
}

// Pull the Call Quality report for the given window, render to PDF, and
// email it via Resend to the configured distribution list. Surfaces
// config errors loudly (no silent no-ops) so a missing env var doesn't
// quietly drop every daily email. `dryRun: true` skips the Resend call
// and returns the PDF buffer for local preview. Reuses PPC_REPORT_FROM_EMAIL
// rather than a dedicated env var, same as lsa-email.ts — same sending
// domain/agency, one less secret to configure.
export async function sendDailyCallQualityEmail(
  opts: SendOpts,
): Promise<SendResult> {
  const recipients = await loadRecipients();
  const fromEmail = process.env.PPC_REPORT_FROM_EMAIL?.trim();
  const apiKey = process.env.RESEND_API_KEY;

  if (recipients.length === 0) {
    throw new Error(
      "No Call Quality report recipients configured — add at least one address on the Settings page",
    );
  }
  if (!fromEmail) {
    throw new Error("PPC_REPORT_FROM_EMAIL is not set");
  }
  if (!opts.dryRun && !apiKey) {
    throw new Error("RESEND_API_KEY is not set");
  }

  const report = await getCallQualityByClientReport({
    from: opts.from,
    to: opts.to,
  });

  // Don't blast an empty PDF to the list — usually means the syncs
  // haven't completed yet or no clients are linked to CallRail on any
  // channel.
  const hasAnyClients = CHANNELS.some(
    (channel) => report.clients[channel].length > 0,
  );
  if (!hasAnyClients) {
    return { sent: 0, reason: "no synced clients for this period" };
  }

  const pdf = await renderCallQualityReportPdf(report, {
    from: opts.from,
    to: opts.to,
  });

  if (opts.dryRun) {
    return { sent: 0, dryRun: true, pdf, recipients };
  }

  const subject = fmtSubject(opts.from, opts.to);
  const filename = `call-quality-report-${opts.to}.pdf`;
  const appUrl = (
    process.env.NEXT_PUBLIC_APP_URL?.trim() || DEFAULT_APP_URL
  ).replace(/\/$/, "");
  const dashboardUrl = `${appUrl}/call-quality`;
  const range = fmtRange(opts.from, opts.to);
  const html = renderEmailHtml({ report, range, dashboardUrl });
  const text = renderEmailText({ report, range, dashboardUrl });

  const resend = new Resend(apiKey!);
  const result = await resend.emails.send({
    from: fromEmail,
    to: recipients,
    subject,
    html,
    text,
    attachments: [
      {
        filename,
        content: pdf,
      },
    ],
  });

  if (result.error) {
    throw new Error(
      `Resend send failed: ${result.error.name ?? "unknown"} — ${result.error.message ?? JSON.stringify(result.error)}`,
    );
  }

  return {
    sent: recipients.length,
    messageId: result.data?.id ?? null,
    recipients,
  };
}
