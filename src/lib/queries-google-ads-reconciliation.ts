import { eq } from "drizzle-orm";
import { pullFormSubmissionCount } from "./callrail";
import { daysAgoIsoEastern, yesterdayIsoEastern } from "./date-utils";
import { db } from "./db/client";
import { ppcClients } from "./db/schema";
import {
  reconcile,
  type ReconRow,
  type ReconSource,
  type ReconSummary,
} from "./ads-reconciliation";
import { getConversionAudit } from "./queries-ads-dashboard";
import { getCallQualityByClientReport } from "./queries-call-quality";
import { getMappingsForClient } from "./queries-google-ads-reconciliation-mappings";
import { stringifyError } from "./leads/sync";

export type ReconciliationResult =
  | {
      ok: true;
      rows: ReconRow[];
      summary: ReconSummary;
      // Non-fatal: the form-submission count couldn't be read (no CallRail
      // company linked, or the API call failed). The other rows still stand.
      formError: string | null;
    }
  | { ok: false; error: string };

const EMPTY_SUMMARY: ReconSummary = { mapped: 0, match: 0, watch: 0, mismatch: 0 };

// Reconcile one PPC client's Google Ads conversion counts against the CallRail
// source metrics each action is mapped to, over [from, to] (Eastern dates).
// Sources are only fetched when a mapping actually needs them, so an account
// with no form mapping never makes the form call, etc.
export async function getReconciliationForClient(
  clientId: string,
  from: string,
  to: string,
): Promise<ReconciliationResult> {
  const mappings = (await getMappingsForClient(clientId)).filter((m) => m.enabled);
  if (mappings.length === 0) {
    return { ok: true, rows: [], summary: EMPTY_SUMMARY, formError: null };
  }

  const needForms = mappings.some((m) => m.source === "callrail_form_submissions");
  const needCalls = mappings.some(
    (m) => m.source === "callrail_first_time_calls" || m.source === "callrail_good_leads",
  );

  // Ads side: per-action conversions in the window (live). Reuses the same
  // conversion-audit pull the Audit tab uses, keyed by action id.
  const audit = await getConversionAudit(clientId, { from, to }, null);
  if (!audit.ok) return { ok: false, error: audit.error };
  const adsByActionId: Record<string, number> = {};
  for (const a of audit.audit.actions) adsByActionId[a.id] = a.conversions;

  const callrail: Record<ReconSource, number> = {
    callrail_first_time_calls: 0,
    callrail_good_leads: 0,
    callrail_form_submissions: 0,
  };
  let formError: string | null = null;

  await Promise.all([
    (async () => {
      if (!needCalls) return;
      // PPC+PMax only (GMB excluded) — the same channels /ppc's "Phone calls"
      // counts, so these line up with what the Ads account can be credited.
      const report = await getCallQualityByClientReport({ from, to });
      const rowFor = (channel: "PPC" | "PMax") =>
        report.clients[channel]?.find((r) => r.clientId === clientId);
      const ppc = rowFor("PPC");
      const pmax = rowFor("PMax");
      callrail.callrail_first_time_calls =
        (ppc?.firstTimeCalls ?? 0) + (pmax?.firstTimeCalls ?? 0);
      callrail.callrail_good_leads = (ppc?.real ?? 0) + (pmax?.real ?? 0);
    })(),
    (async () => {
      if (!needForms) return;
      const [client] = await db
        .select({ companyId: ppcClients.callrailCompanyId })
        .from(ppcClients)
        .where(eq(ppcClients.id, clientId));
      if (!client?.companyId) {
        formError = "No CallRail company linked to this client, so form submissions can't be counted.";
        return;
      }
      try {
        callrail.callrail_form_submissions = await pullFormSubmissionCount(
          client.companyId,
          from,
          to,
        );
      } catch (e) {
        formError = stringifyError(e);
      }
    })(),
  ]);

  const { rows, summary } = reconcile(mappings, { adsByActionId, callrail });
  return { ok: true, rows, summary, formError };
}

export type ConversionActionOption = { id: string; name: string; conversions: number };

export type ConversionActionOptions =
  | { ok: true; actions: ConversionActionOption[] }
  | { ok: false; error: string };

// The account's conversion actions (last 30 days) for the mapping editor's
// dropdown — the same live pull, trimmed to id/name/recent conversions.
export async function getConversionActionOptions(clientId: string): Promise<ConversionActionOptions> {
  const to = yesterdayIsoEastern();
  const from = daysAgoIsoEastern(30);
  const audit = await getConversionAudit(clientId, { from, to }, null);
  if (!audit.ok) return { ok: false, error: audit.error };
  const actions = audit.audit.actions
    .map((a) => ({ id: a.id, name: a.name || a.id, conversions: a.conversions }))
    .sort((a, b) => b.conversions - a.conversions || a.name.localeCompare(b.name));
  return { ok: true, actions };
}
