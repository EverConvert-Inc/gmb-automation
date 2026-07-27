import { Resend } from "resend";
import { asc } from "drizzle-orm";
import { db } from "./db/client";
import { callQualityReportRecipients } from "./db/schema";
import {
  getCallQualityByClientReport,
  type CallQualityByClientReport,
  type CallQualityChannel,
} from "./queries-call-quality";
import { renderCallQualityReportPdf } from "./call-quality-pdf";

const DEFAULT_APP_URL = "https://gmb-automation.vercel.app";
const CHANNELS: CallQualityChannel[] = ["PPC", "LSA", "GMB"];

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

// Inline-styled HTML so it renders consistently across mail clients
// (Gmail strips <style> blocks but respects inline `style=` attributes).
// One row per channel — Real/Junk/Unclassified plus first-time calls,
// since (unlike PPC/LSA) there's no single unified KPI set across
// PPC/LSA/GMB. Full per-client breakdown is in the attached PDF.
function renderEmailHtml({
  report,
  range,
  dashboardUrl,
}: {
  report: CallQualityByClientReport;
  range: string;
  dashboardUrl: string;
}): string {
  const channelRows = CHANNELS.map((channel) => {
    const t = report.summary[channel];
    const cost = channel === "GMB" ? "—" : fmtMicros(t.costMicros);
    return `
      <tr>
        <td style="padding:6px 4px;font-size:13px;font-weight:600;color:#0f172a;">${channel}</td>
        <td style="padding:6px 4px;font-size:13px;text-align:right;color:#334155;">${fmtNumber(t.firstTimeCalls)}</td>
        <td style="padding:6px 4px;font-size:13px;text-align:right;color:#334155;">${fmtNumber(t.real)}</td>
        <td style="padding:6px 4px;font-size:13px;text-align:right;color:#334155;">${fmtNumber(t.junk)}</td>
        <td style="padding:6px 4px;font-size:13px;text-align:right;color:#334155;">${fmtNumber(t.unclassified)}</td>
        <td style="padding:6px 4px;font-size:13px;text-align:right;color:#334155;">${cost}</td>
      </tr>`;
  }).join("");

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
                <th align="right" style="padding:6px 4px;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#64748b;border-bottom:1px solid #e2e8f0;">Real</th>
                <th align="right" style="padding:6px 4px;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#64748b;border-bottom:1px solid #e2e8f0;">Junk</th>
                <th align="right" style="padding:6px 4px;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#64748b;border-bottom:1px solid #e2e8f0;">Unclass.</th>
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
            Full per-client breakdown across PPC, LSA, and GMB is attached as a PDF.
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

// Plain-text fallback for email clients that don't render HTML (and
// improves deliverability — Gmail dings senders who only ship HTML).
function renderEmailText({
  report,
  range,
  dashboardUrl,
}: {
  report: CallQualityByClientReport;
  range: string;
  dashboardUrl: string;
}): string {
  const lines = CHANNELS.map((channel) => {
    const t = report.summary[channel];
    const cost = channel === "GMB" ? "—" : fmtMicros(t.costMicros);
    return `${channel.padEnd(5)} first-time ${fmtNumber(t.firstTimeCalls)}, real ${fmtNumber(t.real)}, junk ${fmtNumber(t.junk)}, unclassified ${fmtNumber(t.unclassified)}, cost ${cost}`;
  });
  return [
    `Call Quality report — ${range}`,
    ``,
    ...lines,
    ``,
    `Full per-client breakdown across PPC, LSA, and GMB is attached as a PDF.`,
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
