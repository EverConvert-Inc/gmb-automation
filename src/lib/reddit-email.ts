import { Resend } from "resend";
import { asc } from "drizzle-orm";
import { db } from "./db/client";
import { redditReportRecipients } from "./db/schema";
import { getRedditReport, UNMAPPED_KEY, type RedditReport } from "./queries-reddit";
import { renderRedditReportPdf } from "./reddit-pdf";

// Daily Reddit spend email, same shape as lsa-email.ts: inline-styled
// summary in the body, full report as a PDF attachment, own recipient list.

const DEFAULT_APP_URL = "https://gmb-automation.vercel.app";

type SendOpts = {
  from: string; // YYYY-MM-DD, start of report window (Eastern)
  to: string; // YYYY-MM-DD, end of report window (Eastern)
  dryRun?: boolean;
};

type SendResult =
  | { sent: number; messageId: string | null; recipients: string[] }
  | { sent: 0; reason: string }
  | { sent: 0; dryRun: true; pdf: Buffer; recipients: string[] };

// The unique constraint on email plus the API's lowercase normalization
// mean no dedup is needed here.
async function loadRecipients(): Promise<string[]> {
  const rows = await db.query.redditReportRecipients.findMany({
    orderBy: asc(redditReportRecipients.email),
    columns: { email: true },
  });
  return rows.map((r) => r.email);
}

function fmtMicros(micros: bigint): string {
  const dollars = Number(micros / 10_000n) / 100;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(dollars);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtRange(fromIso: string, toIso: string, month: "long" | "short"): string {
  const f = new Date(fromIso + "T00:00:00Z");
  const t = new Date(toIso + "T00:00:00Z");
  const m = (d: Date) => d.toLocaleString("en-US", { month, timeZone: "UTC" });
  if (f.getUTCFullYear() === t.getUTCFullYear() && f.getUTCMonth() === t.getUTCMonth()) {
    return fromIso === toIso
      ? `${m(t)} ${t.getUTCDate()}, ${t.getUTCFullYear()}`
      : `${m(f)} ${f.getUTCDate()}–${t.getUTCDate()}, ${t.getUTCFullYear()}`;
  }
  return `${m(f)} ${f.getUTCDate()} – ${m(t)} ${t.getUTCDate()}, ${t.getUTCFullYear()}`;
}

function share(report: RedditReport, micros: bigint): string {
  return report.totalMicros > 0n
    ? `${((Number(micros) / Number(report.totalMicros)) * 100).toFixed(1)}%`
    : "—";
}

function priorText(report: RedditReport): string {
  const { totalMicros: cur, priorTotalMicros: prior } = report;
  if (cur === 0n && prior === 0n) return "no prior";
  if (cur === prior) return "no change vs prior period";
  const diff = cur - prior;
  return `${diff > 0n ? "+" : "−"}${fmtMicros(diff > 0n ? diff : -diff)} vs prior period`;
}

// Warnings that change how the numbers should be read; shown in both the
// HTML and text bodies so nobody misses them in a preview pane.
function notices(report: RedditReport): string[] {
  const out: string[] = [];
  if (report.excludedAccounts.length) {
    out.push(
      `Non-USD accounts excluded from totals: ${report.excludedAccounts
        .map((a) => `${a.name} (${a.currency ?? "unknown currency"})`)
        .join(", ")}`,
    );
  }
  if (report.failingAccounts.length) {
    out.push(
      `Last sync failed, spend may be incomplete: ${report.failingAccounts.map((a) => a.name).join(", ")}`,
    );
  }
  if (report.unmappedAccountCount) {
    out.push(
      `${report.unmappedAccountCount} ad account${report.unmappedAccountCount === 1 ? " isn't" : "s aren't"} mapped to a client yet (shown as Unmapped)`,
    );
  }
  return out;
}

export function renderRedditEmailHtml(report: RedditReport, appUrl: string): string {
  const dayCount = report.dates.length;
  const avgDaily = dayCount ? report.totalMicros / BigInt(dayCount) : 0n;
  const kpis = [
    { label: "Spend", value: fmtMicros(report.totalMicros), sub: priorText(report) },
    { label: "Avg daily spend", value: fmtMicros(avgDaily), sub: `${dayCount} day${dayCount === 1 ? "" : "s"}` },
    { label: "Active accounts", value: String(report.activeAccountCount), sub: `${report.unmappedAccountCount} unmapped` },
  ];
  const kpiRow = kpis
    .map(
      (c) => `
      <td width="33%" valign="top" style="padding:0 4px;">
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px;">
          <div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#64748b;">${c.label}</div>
          <div style="font-size:20px;font-weight:600;color:#0f172a;margin-top:4px;">${c.value}</div>
          <div style="font-size:11px;color:#64748b;margin-top:2px;">${escapeHtml(c.sub)}</div>
        </div>
      </td>`,
    )
    .join("");
  const noticeHtml = notices(report)
    .map(
      (n) => `
          <div style="margin:0 0 8px;padding:8px 10px;border:1px solid #fcd34d;background:#fffbeb;border-radius:6px;font-size:12px;color:#78350f;">${escapeHtml(n)}</div>`,
    )
    .join("");
  const clientRows = report.clients
    .map(
      (c) => `
            <tr>
              <td style="padding:5px 8px;border-top:1px solid #e2e8f0;${c.key === UNMAPPED_KEY ? "font-style:italic;color:#64748b;" : ""}">${escapeHtml(c.name)}</td>
              <td style="padding:5px 8px;border-top:1px solid #e2e8f0;text-align:right;">${fmtMicros(c.totalMicros)}</td>
              <td style="padding:5px 8px;border-top:1px solid #e2e8f0;text-align:right;color:#64748b;">${share(report, c.totalMicros)}</td>
            </tr>`,
    )
    .join("");

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;">
      <tr>
        <td style="padding:24px 24px 8px;">
          <div style="font-size:10px;font-weight:500;letter-spacing:1.5px;text-transform:uppercase;color:#64748b;">Paid Social</div>
          <h1 style="margin:4px 0 4px;font-size:22px;font-weight:700;color:#0f172a;">Reddit spend report</h1>
          <p style="margin:0;font-size:14px;color:#64748b;">${fmtRange(report.from, report.to, "long")} · Eastern days</p>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 20px 8px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>${kpiRow}</tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 24px 0;">${noticeHtml}
          <div style="font-size:13px;font-weight:600;color:#0f172a;margin:8px 0 10px;">Spend by client</div>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:12px;border-collapse:collapse;border:1px solid #e2e8f0;">
            <tr style="background:#f8fafc;color:#64748b;text-transform:uppercase;font-size:9px;">
              <th style="padding:5px 8px;text-align:left;">Client</th>
              <th style="padding:5px 8px;text-align:right;">Spend</th>
              <th style="padding:5px 8px;text-align:right;">Share</th>
            </tr>${clientRows}
            <tr style="font-weight:600;">
              <td style="padding:5px 8px;border-top:1px solid #0f172a;">Total</td>
              <td style="padding:5px 8px;border-top:1px solid #0f172a;text-align:right;">${fmtMicros(report.totalMicros)}</td>
              <td style="padding:5px 8px;border-top:1px solid #0f172a;text-align:right;">${report.totalMicros > 0n ? "100%" : "—"}</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 24px 8px;">
          <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#334155;">
            The attached PDF also has spend by client for every day in the range.
          </p>
          <a href="${appUrl}/reddit" style="display:inline-block;padding:10px 18px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500;">View interactive dashboard &rarr;</a>
        </td>
      </tr>
      <tr>
        <td style="padding:24px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.5;">
            Generated automatically by EverConvert Local Visibility Platform.<br/>
            Manage who receives this report at
            <a href="${appUrl}/settings" style="color:#64748b;">/settings</a>.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// Plain-text fallback for clients that don't render HTML (and for
// deliverability, same as the PPC/LSA emails).
export function renderRedditEmailText(report: RedditReport, appUrl: string): string {
  const width = Math.max(5, ...report.clients.map((c) => c.name.length));
  return [
    `Reddit spend report — ${fmtRange(report.from, report.to, "long")} (Eastern days)`,
    ``,
    `Spend  ${fmtMicros(report.totalMicros)} (${priorText(report)})`,
    ...notices(report).map((n) => `! ${n}`),
    ``,
    `Spend by client`,
    ...report.clients.map(
      (c) => `  ${c.name.padEnd(width)}  ${fmtMicros(c.totalMicros).padStart(12)}  ${share(report, c.totalMicros)}`,
    ),
    `  ${"Total".padEnd(width)}  ${fmtMicros(report.totalMicros).padStart(12)}`,
    ``,
    `The attached PDF also has spend by client for every day in the range.`,
    ``,
    `Open the interactive dashboard:`,
    `${appUrl}/reddit`,
    ``,
    `— EverConvert Local Visibility Platform`,
  ].join("\n");
}

// Config errors throw rather than silently skipping, as in the LSA email.
// Sends from PPC_REPORT_FROM_EMAIL like the LSA and Call Quality emails.
export async function sendDailyRedditEmail(opts: SendOpts): Promise<SendResult> {
  const recipients = await loadRecipients();
  const fromEmail = process.env.PPC_REPORT_FROM_EMAIL?.trim();
  const apiKey = process.env.RESEND_API_KEY;

  if (recipients.length === 0) {
    throw new Error(
      "No Reddit report recipients configured — add at least one address on the Settings page",
    );
  }
  if (!fromEmail) throw new Error("PPC_REPORT_FROM_EMAIL is not set");
  if (!opts.dryRun && !apiKey) throw new Error("RESEND_API_KEY is not set");

  const report = await getRedditReport({ from: opts.from, to: opts.to });

  // Don't send a page of $0.00 — usually means Reddit isn't connected or
  // the sync hasn't run yet.
  if (report.totalMicros === 0n) {
    return { sent: 0, reason: "no Reddit spend for this period" };
  }

  const pdf = await renderRedditReportPdf(report);
  if (opts.dryRun) return { sent: 0, dryRun: true, pdf, recipients };

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL?.trim() || DEFAULT_APP_URL).replace(/\/$/, "");
  const resend = new Resend(apiKey!);
  const result = await resend.emails.send({
    from: fromEmail,
    to: recipients,
    subject: `Reddit spend report — ${fmtRange(opts.from, opts.to, "short")}`,
    html: renderRedditEmailHtml(report, appUrl),
    text: renderRedditEmailText(report, appUrl),
    attachments: [{ filename: `reddit-spend-report-${opts.to}.pdf`, content: pdf }],
  });

  if (result.error) {
    throw new Error(
      `Resend send failed: ${result.error.name ?? "unknown"} — ${result.error.message ?? JSON.stringify(result.error)}`,
    );
  }
  return { sent: recipients.length, messageId: result.data?.id ?? null, recipients };
}
