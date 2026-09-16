import { Resend } from "resend";
import { asc } from "drizzle-orm";
import { db } from "./db/client";
import { lsaReportRecipients } from "./db/schema";
import { getLsaReport, type LsaReport } from "./queries-lsa";
import { renderLsaReportPdf } from "./lsa-pdf";
import { STATE_NAMES } from "./report-grouping";

const DEFAULT_APP_URL = "https://gmb-automation.vercel.app";

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
// uniqueness constraint on `lsa_report_recipients.email` plus the API's
// lowercase normalization mean we don't need to dedup here.
async function loadRecipients(): Promise<string[]> {
  const rows = await db.query.lsaReportRecipients.findMany({
    orderBy: asc(lsaReportRecipients.email),
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
function fmtUsd(dollars: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(dollars);
}
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function fmtAdsIdLast4(id: string | null): string {
  return id ? id.slice(-4) : "—";
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
    return `LSA report — ${m(f)} ${f.getUTCDate()}–${t.getUTCDate()}, ${t.getUTCFullYear()}`;
  }
  return `LSA report — ${m(f)} ${f.getUTCDate()} – ${m(t)} ${t.getUTCDate()}, ${t.getUTCFullYear()}`;
}

// Email has no interactivity, so every non-empty state section renders
// fully expanded (no collapse/expand) — same stateGroups the web page
// uses, same per-client columns as the web table (client-level rows only;
// LSA has no per-campaign dimension to drill into, unlike PPC).
export function renderStateBreakdownHtml(stateGroups: LsaReport["stateGroups"]): string {
  if (stateGroups.length === 0) return "";
  const sections = stateGroups
    .map((group) => {
      const fullName = (STATE_NAMES as Record<string, string>)[group.state];
      const title = fullName ? `${fullName} (${group.state})` : group.state;
      const r = group.rollup;
      const kpiText = [
        `Phone calls ${fmtNumber(r.phoneCallCount)}`,
        `Messages ${fmtNumber(r.messageCount)}`,
        `Signed ${fmtNumber(r.signedCases)}`,
        `Cost ${fmtMicros(r.costMicros)}`,
        `Cost/signed ${r.costPerSignedCase != null ? fmtUsd(r.costPerSignedCase) : "—"}`,
      ].join(" &nbsp;&middot;&nbsp; ");
      const rows = group.clients
        .map(
          (c) => `
            <tr>
              <td style="padding:5px 8px;border-top:1px solid #e2e8f0;">${escapeHtml(c.lsaClientName)}</td>
              <td style="padding:5px 8px;border-top:1px solid #e2e8f0;text-align:right;">${fmtNumber(c.phoneCallCount)}</td>
              <td style="padding:5px 8px;border-top:1px solid #e2e8f0;text-align:right;">${fmtNumber(c.messageCount)}</td>
              <td style="padding:5px 8px;border-top:1px solid #e2e8f0;text-align:right;">${fmtMicros(c.costMicros)}</td>
              <td style="padding:5px 8px;border-top:1px solid #e2e8f0;text-align:right;">${fmtNumber(c.signedCases)}</td>
              <td style="padding:5px 8px;border-top:1px solid #e2e8f0;text-align:right;color:#64748b;">${escapeHtml(fmtAdsIdLast4(c.googleAdsCustomerId))}</td>
            </tr>`,
        )
        .join("");
      return `
        <div style="border:1px solid #e2e8f0;border-radius:6px;margin-bottom:12px;overflow:hidden;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f1f5f9;">
            <tr>
              <td style="padding:8px 10px;font-size:13px;font-weight:600;color:#0f172a;">
                ${escapeHtml(title)}
              </td>
              <td style="padding:8px 10px;font-size:11px;color:#475569;text-align:right;white-space:nowrap;">
                ${kpiText}
              </td>
            </tr>
          </table>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:11px;border-collapse:collapse;">
            <tr style="background:#f8fafc;color:#64748b;text-transform:uppercase;font-size:9px;">
              <th style="padding:5px 8px;text-align:left;">Client</th>
              <th style="padding:5px 8px;text-align:right;">Phone calls</th>
              <th style="padding:5px 8px;text-align:right;">Messages</th>
              <th style="padding:5px 8px;text-align:right;">Cost</th>
              <th style="padding:5px 8px;text-align:right;">Signed</th>
              <th style="padding:5px 8px;text-align:right;">Ads ID</th>
            </tr>
            ${rows}
          </table>
        </div>`;
    })
    .join("");
  return `
      <tr>
        <td style="padding:0 24px 8px;">
          <div style="font-size:13px;font-weight:600;color:#0f172a;margin:8px 0 10px;">State breakdown</div>
          ${sections}
        </td>
      </tr>`;
}

export function renderStateBreakdownText(stateGroups: LsaReport["stateGroups"]): string {
  if (stateGroups.length === 0) return "";
  const lines: string[] = ["", "State breakdown", "================", ""];
  for (const group of stateGroups) {
    const fullName = (STATE_NAMES as Record<string, string>)[group.state];
    const title = fullName ? `${fullName} (${group.state})` : group.state;
    const r = group.rollup;
    lines.push(
      `${title} — Phone calls ${fmtNumber(r.phoneCallCount)} · Messages ${fmtNumber(r.messageCount)} · Signed ${fmtNumber(r.signedCases)} · Cost ${fmtMicros(r.costMicros)} · Cost/signed ${r.costPerSignedCase != null ? fmtUsd(r.costPerSignedCase) : "—"}`,
    );
    for (const c of group.clients) {
      lines.push(
        `  - ${c.lsaClientName}: ${fmtNumber(c.phoneCallCount)} calls, ${fmtNumber(c.messageCount)} msgs, ${fmtMicros(c.costMicros)}, ${fmtNumber(c.signedCases)} signed`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

// Inline-styled HTML so it renders consistently across mail clients
// (Gmail strips <style> blocks but respects inline `style=` attributes).
function renderEmailHtml({
  report,
  range,
  dashboardUrl,
}: {
  report: LsaReport;
  range: string;
  dashboardUrl: string;
}): string {
  const k = report.kpis;
  const kpiCells = [
    { label: "Phone calls", value: fmtNumber(k.phoneCallCount) },
    { label: "Messages", value: fmtNumber(k.messageCount) },
    { label: "Signed", value: fmtNumber(k.signedCases) },
    { label: "Cost", value: fmtMicros(k.costMicros) },
  ];
  const kpiRow = kpiCells
    .map(
      (c) => `
      <td width="25%" valign="top" style="padding:0 4px;">
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px;">
          <div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#64748b;">${c.label}</div>
          <div style="font-size:20px;font-weight:600;color:#0f172a;margin-top:4px;">${c.value}</div>
        </div>
      </td>`,
    )
    .join("");

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;">
      <tr>
        <td style="padding:24px 24px 8px;">
          <div style="font-size:10px;font-weight:500;letter-spacing:1.5px;text-transform:uppercase;color:#64748b;">Local Services</div>
          <h1 style="margin:4px 0 4px;font-size:22px;font-weight:700;color:#0f172a;">LSA report</h1>
          <p style="margin:0;font-size:14px;color:#64748b;">${range}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 20px 8px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>${kpiRow}</tr>
          </table>
        </td>
      </tr>
      ${renderStateBreakdownHtml(report.stateGroups)}
      <tr>
        <td style="padding:16px 24px 8px;">
          <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#334155;">
            Full per-client breakdown across all LSA clients is attached as a PDF.
          </p>
          <a href="${dashboardUrl}" style="display:inline-block;padding:10px 18px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500;">View interactive dashboard &rarr;</a>
        </td>
      </tr>
      <tr>
        <td style="padding:24px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.5;">
            Generated automatically by EverConvert Local Visibility Platform.<br/>
            Manage who receives this report at
            <a href="${dashboardUrl.replace(/\/lsa$/, "")}/settings" style="color:#64748b;">/settings</a>.
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
  report: LsaReport;
  range: string;
  dashboardUrl: string;
}): string {
  const k = report.kpis;
  return [
    `LSA report — ${range}`,
    ``,
    `Phone calls  ${fmtNumber(k.phoneCallCount)}`,
    `Messages     ${fmtNumber(k.messageCount)}`,
    `Signed       ${fmtNumber(k.signedCases)}`,
    `Cost         ${fmtMicros(k.costMicros)}`,
    renderStateBreakdownText(report.stateGroups),
    `Full per-client breakdown across all LSA clients is attached as a PDF.`,
    ``,
    `Open the interactive dashboard:`,
    dashboardUrl,
    ``,
    `— EverConvert Local Visibility Platform`,
  ].join("\n");
}

// Pull the LSA report for the given window, render to PDF, and email it
// via Resend to the configured distribution list. Surfaces config errors
// loudly (no silent no-ops) so a missing env var doesn't quietly drop
// every daily email. `dryRun: true` skips the Resend call and returns the
// PDF buffer for local preview. Reuses PPC_REPORT_FROM_EMAIL rather than a
// dedicated LSA env var, per the approved decision — same sending
// domain/agency, one less secret to configure.
export async function sendDailyLsaEmail(opts: SendOpts): Promise<SendResult> {
  const recipients = await loadRecipients();
  const fromEmail = process.env.PPC_REPORT_FROM_EMAIL?.trim();
  const apiKey = process.env.RESEND_API_KEY;

  if (recipients.length === 0) {
    throw new Error(
      "No LSA report recipients configured — add at least one address on the Settings page",
    );
  }
  if (!fromEmail) {
    throw new Error("PPC_REPORT_FROM_EMAIL is not set");
  }
  if (!opts.dryRun && !apiKey) {
    throw new Error("RESEND_API_KEY is not set");
  }

  const report = await getLsaReport({ from: opts.from, to: opts.to });

  // Don't blast an empty PDF to the list — usually means the syncs
  // haven't completed yet or no clients are linked.
  if (report.rows.length === 0) {
    return { sent: 0, reason: "no synced LSA clients for this period" };
  }

  const pdf = await renderLsaReportPdf(report, {
    from: opts.from,
    to: opts.to,
  });

  if (opts.dryRun) {
    return { sent: 0, dryRun: true, pdf, recipients };
  }

  const subject = fmtSubject(opts.from, opts.to);
  const filename = `lsa-report-${opts.to}.pdf`;
  const appUrl = (
    process.env.NEXT_PUBLIC_APP_URL?.trim() || DEFAULT_APP_URL
  ).replace(/\/$/, "");
  const dashboardUrl = `${appUrl}/lsa`;
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
