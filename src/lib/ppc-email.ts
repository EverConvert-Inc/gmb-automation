import { Resend } from "resend";
import { asc } from "drizzle-orm";
import { db } from "./db/client";
import { ppcReportRecipients } from "./db/schema";
import { getPpcReport } from "./queries";
import { renderPpcReportPdf } from "./ppc-pdf";

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
// uniqueness constraint on `ppc_report_recipients.email` plus the API's
// lowercase normalization mean we don't need to dedup here.
async function loadRecipients(): Promise<string[]> {
  const rows = await db.query.ppcReportRecipients.findMany({
    orderBy: asc(ppcReportRecipients.email),
    columns: { email: true },
  });
  return rows.map((r) => r.email);
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
    return `PPC report — ${m(f)} ${f.getUTCDate()}–${t.getUTCDate()}, ${t.getUTCFullYear()}`;
  }
  return `PPC report — ${m(f)} ${f.getUTCDate()} – ${m(t)} ${t.getUTCDate()}, ${t.getUTCFullYear()}`;
}

// Pull the PPC report for the given window, render to PDF, and email it
// via Resend to the configured distribution list. Surfaces config errors
// loudly (no silent no-ops) so a missing env var doesn't quietly drop
// every daily email. `dryRun: true` skips the Resend call and returns the
// PDF buffer for local preview.
export async function sendDailyPpcEmail(opts: SendOpts): Promise<SendResult> {
  const recipients = await loadRecipients();
  const fromEmail = process.env.PPC_REPORT_FROM_EMAIL?.trim();
  const apiKey = process.env.RESEND_API_KEY;

  if (recipients.length === 0) {
    throw new Error(
      "No PPC report recipients configured — add at least one address on the Settings page",
    );
  }
  if (!fromEmail) {
    throw new Error("PPC_REPORT_FROM_EMAIL is not set");
  }
  if (!opts.dryRun && !apiKey) {
    throw new Error("RESEND_API_KEY is not set");
  }

  const report = await getPpcReport({ from: opts.from, to: opts.to });

  // Don't blast an empty PDF to the list — usually means the syncs
  // haven't completed yet or no clients are linked. Operator will
  // notice the absence faster than they'd notice a blank attachment.
  if (report.clientTotals.length === 0) {
    return { sent: 0, reason: "no synced PPC clients for this period" };
  }

  const pdf = await renderPpcReportPdf(report, {
    from: opts.from,
    to: opts.to,
  });

  if (opts.dryRun) {
    return { sent: 0, dryRun: true, pdf, recipients };
  }

  const subject = fmtSubject(opts.from, opts.to);
  const filename = `ppc-report-${opts.to}.pdf`;
  const htmlBody = `
    <p>Daily PPC report attached.</p>
    <p>Open <a href="${process.env.NEXT_PUBLIC_APP_URL ?? ""}/ppc">/ppc</a>
    in the Local Visibility Platform for the interactive view.</p>
  `.trim();

  const resend = new Resend(apiKey!);
  const result = await resend.emails.send({
    from: fromEmail,
    to: recipients,
    subject,
    html: htmlBody,
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
