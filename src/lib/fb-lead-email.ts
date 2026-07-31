import { Resend } from "resend";
import { asc } from "drizzle-orm";
import { db } from "./db/client";
import { fbLeadRecipients } from "./db/schema";
import type { LeadFieldEntry } from "./facebook-leads";

type SendOpts = {
  clientName: string;
  fields: LeadFieldEntry[];
};

type SendResult =
  | { sent: number; messageId: string | null; recipients: string[] }
  | { sent: 0; reason: string };

// Same pattern as lsa-email.ts/ppc-email.ts: recipients managed via a
// dedicated DB table rather than a hardcoded address.
async function loadRecipients(): Promise<string[]> {
  const rows = await db.query.fbLeadRecipients.findMany({
    orderBy: asc(fbLeadRecipients.email),
    columns: { email: true },
  });
  return rows.map((r) => r.email);
}

function renderSubject(clientName: string): string {
  return `New Lead - ${clientName}`;
}

// Every field_data entry rendered as "label: value", in the order the lead
// answered — no hardcoded field names, so custom questions from any
// client's form show up automatically. Meta's own labels for the built-in
// contact fields ("Full Name", "Phone Number", "Email", "State") already
// read correctly under this same rule, so they don't need special-casing.
function renderLines(fields: LeadFieldEntry[]): string {
  return fields.map((f) => `${f.label}: ${f.value || "(blank)"}`).join("\n");
}

function renderText(clientName: string, fields: LeadFieldEntry[]): string {
  return [renderSubject(clientName), "", renderLines(fields)].join("\n");
}

function renderHtml(clientName: string, fields: LeadFieldEntry[]): string {
  const rows = fields
    .map(
      (f) => `
      <tr>
        <td style="padding:4px 12px 4px 0;color:#64748b;font-size:14px;white-space:nowrap;">${escapeHtml(f.label)}</td>
        <td style="padding:4px 0;color:#0f172a;font-size:14px;font-weight:500;">${escapeHtml(f.value || "(blank)")}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;">
      <tr>
        <td style="padding:24px 24px 8px;">
          <div style="font-size:10px;font-weight:500;letter-spacing:1.5px;text-transform:uppercase;color:#64748b;">Facebook Lead Ads</div>
          <h1 style="margin:4px 0 0;font-size:22px;font-weight:700;color:#0f172a;">New Lead - ${escapeHtml(clientName)}</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 24px 24px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">${rows}</table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Surfaces config errors loudly (no silent no-ops), same as
// sendDailyLsaEmail — a missing env var shouldn't quietly drop every lead.
export async function sendFbLeadEmail(opts: SendOpts): Promise<SendResult> {
  const recipients = await loadRecipients();
  const fromEmail = process.env.PPC_REPORT_FROM_EMAIL?.trim();
  const apiKey = process.env.RESEND_API_KEY;

  if (recipients.length === 0) {
    return { sent: 0, reason: "no fb_lead_recipients configured" };
  }
  if (!fromEmail) {
    throw new Error("PPC_REPORT_FROM_EMAIL is not set");
  }
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set");
  }

  const subject = renderSubject(opts.clientName);
  const html = renderHtml(opts.clientName, opts.fields);
  const text = renderText(opts.clientName, opts.fields);

  const resend = new Resend(apiKey);
  const result = await resend.emails.send({
    from: fromEmail,
    to: recipients,
    subject,
    html,
    text,
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
