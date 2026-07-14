import { Resend } from "resend";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "./db/client";
import { oauthCredentials, ppcClients, ppcReportRecipients } from "./db/schema";
import { decryptString } from "./crypto";
import { getCustomer } from "./google-ads";

const DEFAULT_APP_URL = "https://gmb-automation.vercel.app";
const SCORE_THRESHOLD = 0.8;

export type FlaggedCampaign = {
  clientName: string;
  campaignName: string;
  score: number; // 0..1
  optimizationScoreUrl: string | null;
};

async function loadRecipients(): Promise<string[]> {
  const rows = await db.query.ppcReportRecipients.findMany({
    orderBy: asc(ppcReportRecipients.email),
    columns: { email: true },
  });
  return rows.map((r) => r.email);
}

// Queries every active, Ads-linked PPC client's non-LOCAL_SERVICES,
// ENABLED campaigns for optimization_score, flagging anything real (not
// null — a null score means unscored, not "0%") and below the threshold.
// Mirrors syncAllGoogleAds's per-client try/catch in ppc-sync.ts — one
// client's API failure shouldn't stop the sweep.
export async function getFlaggedCampaigns(): Promise<FlaggedCampaign[]> {
  const clients = await db.query.ppcClients.findMany({
    where: and(
      eq(ppcClients.isActive, true),
      sql`${ppcClients.googleAdsOauthTokenId} is not null`,
      sql`${ppcClients.googleAdsCustomerId} is not null`,
    ),
  });

  const flagged: FlaggedCampaign[] = [];

  for (const client of clients) {
    try {
      if (!client.googleAdsOauthTokenId || !client.googleAdsCustomerId) continue;

      const cred = await db.query.oauthCredentials.findFirst({
        where: eq(oauthCredentials.id, client.googleAdsOauthTokenId),
      });
      if (!cred) throw new Error("OAuth credential row missing");

      const refreshToken = decryptString(cred.refreshTokenEncrypted);
      // No login_customer_id override — PPC relies on the single global
      // GOOGLE_ADS_LOGIN_CUSTOMER_ID env var (see getCustomer), same as
      // pullDailyMetrics. LSA's per-client loginCustomerId/extraManagerId
      // pattern doesn't apply here.
      const customer = getCustomer(refreshToken, client.googleAdsCustomerId);

      const rows = await customer.query(`
        SELECT campaign.id, campaign.name, campaign.status, campaign.optimization_score, metrics.optimization_score_url
        FROM campaign
        WHERE campaign.advertising_channel_type != 'LOCAL_SERVICES'
          AND campaign.status = 'ENABLED'
      `);

      for (const r of rows) {
        const campaign = (r as { campaign?: Record<string, unknown> }).campaign ?? {};
        const metrics = (r as { metrics?: Record<string, unknown> }).metrics ?? {};
        const score = campaign.optimization_score;
        if (score === null || score === undefined) continue; // unscored, not "0%"
        const scoreNum = Number(score);
        if (Number.isNaN(scoreNum) || scoreNum >= SCORE_THRESHOLD) continue;

        flagged.push({
          clientName: client.name,
          campaignName: String(campaign.name ?? ""),
          score: scoreNum,
          optimizationScoreUrl:
            typeof metrics.optimization_score_url === "string"
              ? metrics.optimization_score_url
              : null,
        });
      }
    } catch (err) {
      console.error(
        `[ppc-optimization-alert] client "${client.name}" (${client.id}) failed:`,
        err,
      );
    }
  }

  return flagged.sort((a, b) => a.score - b.score);
}

function fmtScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function renderEmailHtml(flagged: FlaggedCampaign[]): string {
  const rows = flagged
    .map(
      (f) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${f.clientName}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${f.campaignName}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#dc2626;font-weight:600;">${fmtScore(f.score)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${
          f.optimizationScoreUrl
            ? `<a href="${f.optimizationScoreUrl}" style="color:#0f172a;">View recommendations &rarr;</a>`
            : "—"
        }</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;">
      <tr>
        <td style="padding:24px 24px 8px;">
          <div style="font-size:10px;font-weight:500;letter-spacing:1.5px;text-transform:uppercase;color:#64748b;">Paid Search</div>
          <h1 style="margin:4px 0 4px;font-size:22px;font-weight:700;color:#0f172a;">Optimization score alert</h1>
          <p style="margin:0;font-size:14px;color:#64748b;">${flagged.length} campaign${flagged.length === 1 ? "" : "s"} below 80%</p>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 24px 24px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="text-align:left;font-size:11px;letter-spacing:0.5px;text-transform:uppercase;color:#64748b;">
                <th style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">Client</th>
                <th style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">Campaign</th>
                <th style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">Score</th>
                <th style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">Recommendations</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0 24px 24px;border-top:1px solid #e2e8f0;padding-top:16px;">
          <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.5;">
            Generated automatically by EverConvert Local Visibility Platform.<br/>
            Manage who receives this alert at
            <a href="${(process.env.NEXT_PUBLIC_APP_URL?.trim() || DEFAULT_APP_URL).replace(/\/$/, "")}/settings" style="color:#64748b;">/settings</a>.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderEmailText(flagged: FlaggedCampaign[]): string {
  return [
    `PPC optimization score alert — ${flagged.length} campaign${flagged.length === 1 ? "" : "s"} below 80%`,
    ``,
    ...flagged.map(
      (f) =>
        `${f.clientName} — ${f.campaignName} — ${fmtScore(f.score)}${f.optimizationScoreUrl ? ` — ${f.optimizationScoreUrl}` : ""}`,
    ),
    ``,
    `— EverConvert Local Visibility Platform`,
  ].join("\n");
}

export type SendAlertResult =
  | { sent: number; messageId: string | null; recipients: string[]; flagged: FlaggedCampaign[] }
  | { sent: 0; reason: string; flagged: FlaggedCampaign[] }
  | { sent: 0; dryRun: true; flagged: FlaggedCampaign[]; recipients: string[] };

// Checks every linked PPC client's campaigns and emails the distribution
// list only if something is actually flagged — no daily noise when every
// campaign scores fine. `dryRun: true` skips the Resend call.
export async function sendPpcOptimizationAlert(
  opts: { dryRun?: boolean } = {},
): Promise<SendAlertResult> {
  const flagged = await getFlaggedCampaigns();

  if (flagged.length === 0) {
    return { sent: 0, reason: "no campaigns below threshold", flagged };
  }

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

  if (opts.dryRun) {
    return { sent: 0, dryRun: true, flagged, recipients };
  }

  const html = renderEmailHtml(flagged);
  const text = renderEmailText(flagged);

  const resend = new Resend(apiKey!);
  const result = await resend.emails.send({
    from: fromEmail,
    to: recipients,
    subject: `PPC optimization score alert — ${flagged.length} campaign${flagged.length === 1 ? "" : "s"} below 80%`,
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
    flagged,
  };
}
