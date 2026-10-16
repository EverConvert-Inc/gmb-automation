// Ingestion for the client-facing lead tracker.
//
// Every dependency is injected. This module never imports the db client or
// the CallRail client directly — the routes wire the real ones in, the tests
// wire fakes in, and the orchestration under test is the same code that
// runs in production.

import {
  firstOfMonthIsoEastern,
  firstOfPreviousMonthIsoEastern,
  easternWallClockToDate,
  lastDayOfPreviousMonthIsoEastern,
  todayIsoEastern,
} from "@/lib/date-utils";
import { parseNote } from "./parse-note";
import { resolveContact } from "./form-fallbacks";
import { resolveStatusFromTags, resolveStatusFromText } from "./status-from-tags";
import {
  buildRoutingIndex,
  resolveFirmsForLead,
  type RoutingIndex,
} from "./routing";
import {
  LEAD_STATUS_TAGS,
  tagNames,
  type TagFilterProbe,
  type TransportOptions,
  type TrackerCallRecord,
  type TrackerFormRecord,
} from "./callrail-client";
import { reconcileLeadRows } from "./reconcile";
import { firmIdsIn, flagPossibleDuplicates } from "./dedup";
import {
  leadKey,
  type JobKind,
  type LeadSource,
  type LeadStore,
  type PlannedLead,
  type TrackerLead,
} from "./types";

// Same discipline as ppc-sync.ts's copy, and it exists for the same real
// production incident: `(err as Error).message` on a non-Error rejection
// evaluates to undefined, Drizzle's .set() drops undefined fields, and an
// update with zero fields throws "No values to set" — masking the actual
// cause entirely.
export function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

export type SyncWindow = {
  currentFrom: string;
  currentTo: string;
  previousFrom: string;
  previousTo: string;
};

/**
 * Month-to-date in EASTERN, plus the previous Eastern month for the
 * still-pending recheck. Every bound comes from date-utils' Eastern helpers:
 * CallRail interprets start_date/end_date in the account's local time, and a
 * UTC-derived bound puts a 21:10 ET lead in the wrong month at a boundary.
 */
export function resolveSyncWindow(): SyncWindow {
  return {
    currentFrom: firstOfMonthIsoEastern(),
    currentTo: todayIsoEastern(),
    previousFrom: firstOfPreviousMonthIsoEastern(),
    previousTo: lastDayOfPreviousMonthIsoEastern(),
  };
}

/**
 * CallRail timestamps carry an offset ("...-04:00"), in which case Date
 * parses them correctly. If one ever arrives as a bare wall clock, treating
 * it as UTC would land it 4-5 hours early, so it is read as Eastern instead
 * — the same correction easternWallClockToDate exists for on the Google Ads
 * side.
 */
export function parseCallrailInstant(value: string | null | undefined): Date | null {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return easternWallClockToDate(s);
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

export function normalizeCall(
  record: TrackerCallRecord,
  companyId: string,
): TrackerLead | null {
  const occurredAt = parseCallrailInstant(record.start_time);
  if (!record.id || !occurredAt) return null;
  return {
    source: "call",
    callrailId: String(record.id),
    callrailCompanyId: companyId,
    occurredAt,
    tags: tagNames(record.tags),
    note: record.note ?? null,
    customerName: record.customer_name ?? null,
    customerPhoneNumber: record.customer_phone_number ?? null,
    rawSourceName: record.source_name ?? record.formatted_tracking_source ?? null,
    rawTrackerId: record.tracker_id ?? null,
    rawFormData: null,
  };
}

export function normalizeForm(
  record: TrackerFormRecord,
  companyId: string,
): TrackerLead | null {
  const occurredAt = parseCallrailInstant(record.submitted_at);
  if (!record.id || !occurredAt) return null;
  return {
    source: "form",
    callrailId: String(record.id),
    callrailCompanyId: companyId,
    occurredAt,
    tags: tagNames(record.tags),
    note: record.note ?? null,
    customerName: record.customer_name ?? null,
    customerPhoneNumber: record.customer_phone_number ?? null,
    // A form has no tracking number; `source` is the closest equivalent and
    // is admin-only either way, same as a call's tracker name.
    rawSourceName: record.source ?? record.referrer ?? null,
    rawTrackerId: null,
    rawFormData: record.form_data ?? null,
  };
}

// ---------------------------------------------------------------------------
// Planning — pure
// ---------------------------------------------------------------------------

export type PlanOptions = {
  now: Date;
};

// NOTE: this planner no longer takes an assigned-firm guard. Keeping a row
// whose routing had gone quiet was the right call while an admin might have
// assigned it by hand; the admin surface sets status, opportunity, name and
// phone and never firm_id, so routing is authoritative and reconcileLeadRows
// decides what happens to rows that no longer match it.

export function planLeadWrites(
  incoming: readonly TrackerLead[],
  index: RoutingIndex,
  { now }: PlanOptions,
): PlannedLead[] {
  const out: PlannedLead[] = [];

  for (const lead of incoming) {
    const tagStatus = resolveStatusFromTags(lead.tags);
    const routing = resolveFirmsForLead(
      { tags: lead.tags, callrailCompanyId: lead.callrailCompanyId },
      index,
    );
    const parsed = parseNote(lead.note, {
      tags: lead.tags,
      callerIdPhone: lead.customerPhoneNumber,
    });

    const fallbackSource = {
      customerName: lead.customerName,
      customerPhoneNumber: lead.customerPhoneNumber,
      formData: lead.rawFormData,
    };

    type PersonPlan = {
      personSuffix: string;
      name: string | null;
      phone: string | null;
      status: "pending" | "signed";
      statusTagMatched: string | null;
      isOpportunity: boolean;
    };

    let people: PersonPlan[];
    let parseFailed = false;
    let parseError: string | null = null;

    if (parsed.ok) {
      people = parsed.people.map((p) => {
        // A multi-person note gives each person their own status text, and
        // the spec makes that authoritative for that person — but only when
        // it is a word on the status ladder. A typo or an unknown word ("Signd",
        // "Retained") says nothing reliable, so that person falls back to the
        // call's tags, exactly as if they had no status text. Without this, an
        // unrecognised word silently became the default "pending" and hid a
        // call tagged Signed. The Opportunity flag is unioned: the person's own
        // text, or a lead-level Opportunity tag, applies.
        const fromText = p.statusText ? resolveStatusFromText(p.statusText) : null;
        const own = fromText && fromText.matchedTag !== null ? fromText : tagStatus;
        const contact = resolveContact({ name: p.name, phone: p.phone }, fallbackSource);
        return {
          personSuffix: p.personSuffix,
          name: contact.name,
          phone: contact.phone,
          status: own.status,
          statusTagMatched: own.matchedTag,
          isOpportunity: (fromText?.isOpportunity ?? false) || tagStatus.isOpportunity,
        };
      });
    } else {
      // A parse failure still produces a lead. Dropping it would mean a real
      // person silently never reaching anyone; the admin queue is where it
      // goes instead, with whatever the fallbacks could recover.
      parseFailed = true;
      parseError = parsed.detail
        ? `${parsed.reason}: ${parsed.detail}`
        : parsed.reason;
      const contact = resolveContact({ name: null, phone: null }, fallbackSource);
      people = [
        {
          personSuffix: "p1",
          name: contact.name,
          phone: contact.phone,
          status: tagStatus.status,
          statusTagMatched: tagStatus.matchedTag,
          isOpportunity: tagStatus.isOpportunity,
        },
      ];
    }

    for (const person of people) {
      // Routing alone decides the targets. What happens to rows that no
      // longer match — promotion, a move, a demotion back to the queue, or
      // surplus — is reconcileLeadRows' job, which can see the existing
      // rows and this cannot.
      const targets: (string | null)[] =
        routing.firmIds.length > 0 ? routing.firmIds : [null];

      for (const firmId of targets) {
        out.push({
          firmId,
          source: lead.source,
          callrailId: lead.callrailId,
          personSuffix: person.personSuffix,
          callrailCompanyId: lead.callrailCompanyId,
          occurredAt: lead.occurredAt,
          rawSourceName: lead.rawSourceName,
          rawTrackerId: lead.rawTrackerId,
          rawNote: lead.note,
          rawTags: lead.tags,
          rawFormData: lead.rawFormData,
          customerPhoneCallerid: lead.customerPhoneNumber,
          nameParsed: person.name,
          phoneParsed: person.phone,
          statusParsed: person.status,
          statusTagMatched: person.statusTagMatched,
          isOpportunityParsed: person.isOpportunity,
          suggestedStatus: person.status,
          parseFailed,
          parseError,
          needsReview: firmId === null || parseFailed,
          // Filled by the dedup pass, which needs the firm's stored phones
          // and so cannot run inside the planner.
          possibleDuplicateOf: null,
          // Only ever a proposal: the store applies it with
          // coalesce(existing, new), so a webhook receipt time already on
          // the row wins.
          signedAt: person.status === "signed" ? now : null,
        });
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Dry-run masking
// ---------------------------------------------------------------------------

export function maskName(name: string | null): string | null {
  if (!name) return name;
  return name
    .split(/(\s+)/)
    .map((part) =>
      /^\s+$/.test(part) || part.length === 0
        ? part
        : part[0] + "*".repeat(Math.max(1, part.length - 1)),
    )
    .join("");
}

export function maskPhone(phone: string | null): string | null {
  if (!phone) return phone;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***${digits.slice(-4)}`;
}

/**
 * Reduces a note to its SHAPE: every word becomes its initial, every digit a
 * "#", and all punctuation is left alone. "Jane Doe; maiden name Smith,
 * 555-123-4567" becomes "J. D.; m. n. S., ###-###-####".
 *
 * The point is to make a parse failure diagnosable — where the semicolons
 * and commas fall is the whole question — without carrying a name or a
 * phone number out of the function. Dry run only: nothing on the real path
 * calls this, and no note is ever logged anywhere.
 */
export function redactNoteStructure(
  note: string | null | undefined,
): string | null {
  if (note == null) return null;
  return note.replace(/\p{L}+/gu, (w) => `${w[0]}.`).replace(/\d/g, "#");
}

export type NoteStructureSample = {
  source: LeadSource;
  callrailId: string;
  /** The ParseFailureReason, without its detail — the detail can quote text. */
  reason: string;
  hasSemicolon: boolean;
  noteStructure: string | null;
};

/** Keeps a dry-run response readable, and bounds what leaves the function. */
export const NOTE_STRUCTURE_SAMPLE_CAP = 20;

/**
 * Time a run may spend FETCHING before it stops starting new companies and
 * writes what it has. The route's maxDuration is 300s; this leaves room for
 * the company in flight, planning, the writes and finishJob.
 */
export const FETCH_BUDGET_MS = 220_000;

/** A job still 'running' this long after it started cannot still be alive (maxDuration is 300s). */
export const STALE_JOB_MINUTES = 15;
export const STALE_JOB_MESSAGE = "No finish recorded (likely stopped at the 300s time limit)";

export type MaskedSample = {
  source: LeadSource;
  callrailId: string;
  personSuffix: string;
  firmId: string | null;
  occurredAt: string;
  name: string | null;
  phone: string | null;
  statusParsed: string;
  statusTagMatched: string | null;
  isOpportunity: boolean;
  parseFailed: boolean;
  parseError: string | null;
  needsReview: boolean;
  tags: string[];
};

export function toMaskedSample(row: PlannedLead): MaskedSample {
  return {
    source: row.source,
    callrailId: row.callrailId,
    personSuffix: row.personSuffix,
    firmId: row.firmId,
    occurredAt: row.occurredAt.toISOString(),
    name: maskName(row.nameParsed),
    phone: maskPhone(row.phoneParsed),
    statusParsed: row.statusParsed,
    statusTagMatched: row.statusTagMatched,
    isOpportunity: row.isOpportunityParsed,
    parseFailed: row.parseFailed,
    parseError: row.parseError,
    needsReview: row.needsReview,
    tags: row.rawTags,
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export type SyncDeps = {
  listCompanyIds: (opts: TransportOptions) => Promise<string[]>;
  fetchCalls: (
    companyId: string,
    from: string,
    to: string,
    opts: TransportOptions,
  ) => Promise<TrackerCallRecord[]>;
  fetchForms: (
    companyId: string,
    from: string,
    to: string,
    opts: TransportOptions,
  ) => Promise<TrackerFormRecord[]>;
  store: LeadStore;
  now: () => Date;
  /**
   * Dry run only. Optional so a test can leave it out; when absent the
   * probe is simply skipped.
   */
  probeTagFilter?: (
    kind: "calls" | "forms",
    companyId: string,
    from: string,
    to: string,
    opts: TransportOptions,
  ) => Promise<TagFilterProbe>;
};

/**
 * Which CallRail companies a run fetches.
 * - "all": every non-disabled company in the account (the default, and what a
 *   manual run does).
 * - "mapped": only companies in lead_firm_callrail_companies for an active
 *   firm — what the daily cron uses. Routing is unchanged for what is fetched
 *   (a firm tag still wins over the company), but a lead on a company mapped
 *   to no firm is never fetched, so it can reach neither a tag-matched firm
 *   nor the admin queue.
 */
export type SyncScope = "all" | "mapped";

export type SyncOptions = {
  triggeredBy?: string;
  dryRun?: boolean;
  /** Defaults to "all". Ignored when companyIds is given. */
  scope?: SyncScope;
  /** Defaults to FETCH_BUDGET_MS. Shared by the calls and forms passes. */
  fetchBudgetMs?: number;
  /** Overrides company discovery. Narrows what is fetched and stored. */
  companyIds?: string[];
  transport?: TransportOptions;
  sampleSize?: number;
};

export type SourceResult = {
  jobId: string | null;
  fetched: number;
  recheckedFromPreviousMonth: number;
  planned: number;
  assigned: number;
  unassigned: number;
  parseFailed: number;
  written: number;
  /** Rows moved between firms (or promoted/demoted) rather than inserted. */
  repointed: number;
  /** Rows whose effective phone already exists at the same firm. */
  possibleDuplicates: number;
  /** Surplus rows removed — they carried no overrides and no notes. */
  deleted: number;
  /** Surplus rows kept and flagged because a human had touched them. */
  flaggedStale: number;
  fieldsSeen: string[];
  /** Dry run only — empty on a real run. Counts DISTINCT failed leads. */
  parseFailureReasons: Record<string, number>;
  /** Dry run only — empty on a real run. Capped, and carries no PII. */
  noteStructures: NoteStructureSample[];
  /**
   * Set when the fetch budget ran out before every company was fetched. What
   * was fetched is still written; the job row is finished as failed.
   */
  stoppedEarly: { phase: "current" | "previous"; afterCompanies: number; of: number } | null;
  error: string | null;
};

export type SyncResult = {
  dryRun: boolean;
  /** "explicit" when the run was given companyIds. */
  scope: SyncScope | "explicit";
  /** Jobs left 'running' by earlier runs and marked failed at the start of this one. Null on a dry run or if the cleanup itself failed. */
  staleJobsFailed: number | null;
  window: SyncWindow;
  companies: number;
  /** The tags every fetch is filtered to, echoed so a run is self-describing. */
  tagFilter: readonly string[];
  calls: SourceResult;
  forms: SourceResult;
  sample: MaskedSample[];
  /**
   * Dry run only. Whether CallRail's repeated tags[] param unions or
   * intersects — an assumption the fetch depends on and the docs do not
   * settle. Null on a real run or when no company was fetched.
   */
  tagFilterProbe: { calls: TagFilterProbe | null; forms: TagFilterProbe | null };
};

function emptySourceResult(): SourceResult {
  return {
    jobId: null,
    fetched: 0,
    recheckedFromPreviousMonth: 0,
    planned: 0,
    assigned: 0,
    unassigned: 0,
    parseFailed: 0,
    written: 0,
    repointed: 0,
    possibleDuplicates: 0,
    deleted: 0,
    flaggedStale: 0,
    fieldsSeen: [],
    parseFailureReasons: {},
    noteStructures: [],
    stoppedEarly: null,
    error: null,
  };
}

/** The job row's message for a run that ran out of fetch budget. */
export function stoppedEarlyMessage(s: NonNullable<SourceResult["stoppedEarly"]>, budgetMs: number): string {
  const budget = `fetch budget ${Math.round(budgetMs / 1000)}s`;
  return s.phase === "current"
    ? `stopped after ${s.afterCompanies} of ${s.of} companies (${budget})`
    : `stopped after ${s.of} of ${s.of} companies; previous-month recheck stopped after ${s.afterCompanies} of ${s.of} (${budget})`;
}

/**
 * The companies the routing rules name, once each, in a stable order. These
 * come from loadRoutingRules, which already excludes inactive firms.
 */
export function mappedCompanyIds(companyRules: readonly { callrailCompanyId: string }[]): string[] {
  const ids = new Set<string>();
  for (const r of companyRules) {
    const id = r.callrailCompanyId?.trim();
    if (id) ids.add(id);
  }
  return [...ids].sort();
}

export async function syncLeadsForMonth(
  deps: SyncDeps,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const dryRun = options.dryRun === true;
  const triggeredBy = options.triggeredBy ?? (dryRun ? "dry-run" : "manual");
  const transport = options.transport ?? {};
  const sampleSize = options.sampleSize ?? 10;
  const window = resolveSyncWindow();
  const startedMs = deps.now().getTime();
  const fetchBudgetMs = options.fetchBudgetMs ?? FETCH_BUDGET_MS;
  const deadlineMs = startedMs + fetchBudgetMs;

  // Earlier runs killed at the time limit never finished their job rows.
  // Never fatal: a failed cleanup must not stop today's sync.
  let staleJobsFailed: number | null = null;
  if (!dryRun) {
    try {
      staleJobsFailed = await deps.store.failStaleJobs({
        startedBefore: new Date(startedMs - STALE_JOB_MINUTES * 60_000),
        message: STALE_JOB_MESSAGE,
      });
    } catch {
      staleJobsFailed = null;
    }
  }

  const { tagRules, companyRules } = await deps.store.loadRoutingRules();
  const index = buildRoutingIndex(tagRules, companyRules);

  const scope: SyncResult["scope"] = options.companyIds ? "explicit" : (options.scope ?? "all");
  const companyIds =
    options.companyIds ??
    (scope === "mapped"
      ? mappedCompanyIds(companyRules)
      : await deps.listCompanyIds(transport));

  const sample: MaskedSample[] = [];

  // Calls and forms get their OWN job row and their own try/catch, so a
  // forms failure never marks the calls ingestion failed — the same
  // independent-source discipline lsa-sync.ts uses for its two sources.
  const calls = await runSourcePass<TrackerCallRecord>({
    source: "call",
    kind: "callrail_calls",
    deps,
    index,
    window,
    companyIds,
    transport,
    dryRun,
    triggeredBy,
    sample,
    sampleSize,
    fetchPage: (companyId, from, to) => deps.fetchCalls(companyId, from, to, transport),
    normalize: normalizeCall,
    deadlineMs,
    fetchBudgetMs,
  });

  const forms = await runSourcePass<TrackerFormRecord>({
    source: "form",
    kind: "callrail_forms",
    deps,
    index,
    window,
    companyIds,
    transport,
    dryRun,
    triggeredBy,
    sample,
    sampleSize,
    fetchPage: (companyId, from, to) => deps.fetchForms(companyId, from, to, transport),
    normalize: normalizeForm,
    deadlineMs,
    fetchBudgetMs,
  });

  // One company is enough to settle the semantics question, and three extra
  // single-record requests is the whole cost.
  let tagFilterProbe: SyncResult["tagFilterProbe"] = { calls: null, forms: null };
  if (dryRun && deps.probeTagFilter && companyIds.length > 0) {
    const probeCompany = companyIds[0];
    const [callsProbe, formsProbe] = await Promise.all([
      deps
        .probeTagFilter("calls", probeCompany, window.currentFrom, window.currentTo, transport)
        .catch(() => null),
      deps
        .probeTagFilter("forms", probeCompany, window.currentFrom, window.currentTo, transport)
        .catch(() => null),
    ]);
    tagFilterProbe = { calls: callsProbe, forms: formsProbe };
  }

  return {
    dryRun,
    scope,
    staleJobsFailed,
    window,
    companies: companyIds.length,
    tagFilter: LEAD_STATUS_TAGS,
    calls,
    forms,
    sample,
    tagFilterProbe,
  };
}

type SourcePassInput<R> = {
  source: LeadSource;
  kind: JobKind;
  deps: SyncDeps;
  index: RoutingIndex;
  window: SyncWindow;
  companyIds: readonly string[];
  transport: TransportOptions;
  dryRun: boolean;
  triggeredBy: string;
  sample: MaskedSample[];
  sampleSize: number;
  fetchPage: (companyId: string, from: string, to: string) => Promise<R[]>;
  normalize: (record: R, companyId: string) => TrackerLead | null;
  /** No new company fetch starts at or after this instant (ms). */
  deadlineMs: number;
  fetchBudgetMs: number;
};

async function runSourcePass<R extends { id: string }>(
  input: SourcePassInput<R>,
): Promise<SourceResult> {
  const { deps, window, dryRun, sample, sampleSize } = input;
  const result = emptySourceResult();
  const fieldsSeen = new Set<string>();

  if (!dryRun) {
    result.jobId = await deps.store.startJob({
      kind: input.kind,
      triggeredBy: input.triggeredBy,
      fromDate: window.currentFrom,
      toDate: window.currentTo,
    });
  }

  try {
    const collected: TrackerLead[] = [];
    const total = input.companyIds.length;
    const outOfTime = () => deps.now().getTime() >= input.deadlineMs;

    for (const [i, companyId] of input.companyIds.entries()) {
      // Checked BEFORE each company: once the budget is spent, stop starting
      // new fetches and write what was collected. Companies not reached are
      // untouched — reconciliation only ever sees the ids fetched this run.
      if (outOfTime()) {
        result.stoppedEarly = { phase: "current", afterCompanies: i, of: total };
        break;
      }
      const records = await input.fetchPage(
        companyId,
        window.currentFrom,
        window.currentTo,
      );
      result.fetched += records.length;
      for (const r of records) {
        for (const k of Object.keys(r ?? {})) fieldsSeen.add(k);
        const lead = input.normalize(r, companyId);
        if (lead) collected.push(lead);
      }
    }

    // Second pass: the previous Eastern month, narrowed to leads we already
    // hold that are STILL pending. This is the only path by which a lead
    // signed after its own month closes ever gets its signed date from a
    // sync — the month-to-date window above can never see it, because
    // CallRail's date filter is on the call time, not the tag time.
    //
    // The window is re-fetched and matched by callrail_id rather than
    // fetched id-by-id: it is one paginated request per company instead of
    // one per lead, and it needs no per-record endpoint.
    const pendingIds = await deps.store.findPendingCallrailIds(
      window.previousFrom,
      window.previousTo,
      input.source,
    );
    if (pendingIds.size > 0 && result.stoppedEarly === null) {
      for (const [i, companyId] of input.companyIds.entries()) {
        if (outOfTime()) {
          result.stoppedEarly = { phase: "previous", afterCompanies: i, of: total };
          break;
        }
        const records = await input.fetchPage(
          companyId,
          window.previousFrom,
          window.previousTo,
        );
        for (const r of records) {
          if (!pendingIds.has(String(r?.id))) continue;
          const lead = input.normalize(r, companyId);
          if (!lead) continue;
          collected.push(lead);
          result.recheckedFromPreviousMonth += 1;
        }
      }
    }

    const existingRows = await deps.store.findExistingLeadRows(
      collected.map((l) => l.callrailId),
    );
    const rawPlanned = planLeadWrites(collected, input.index, { now: deps.now() });

    // Soft dedup runs AFTER planning, because it needs the firm each row
    // routed to, and BEFORE reconciliation, because the flag travels on the
    // row being written. It compares against rows already stored — two new
    // leads sharing a phone in the SAME run are caught on the next one,
    // once the first is on file.
    const phoneIndex = await deps.store.findFirmPhoneIndex(firmIdsIn(rawPlanned));
    const deduped = flagPossibleDuplicates(rawPlanned, phoneIndex);
    const planned = deduped.rows;
    result.possibleDuplicates = deduped.flagged;

    const reconciliation = reconcileLeadRows(planned, existingRows);

    result.planned = planned.length;
    result.assigned = planned.filter((p) => p.firmId !== null).length;
    result.unassigned = planned.filter((p) => p.firmId === null).length;
    result.parseFailed = planned.filter((p) => p.parseFailed).length;

    for (const row of planned) {
      if (sample.length >= sampleSize) break;
      sample.push(toMaskedSample(row));
    }

    if (dryRun) {
      collectParseFailureDiagnostics(planned, result);
    }

    // Reported on a dry run too, so the first run after firms are configured
    // can be inspected before anything moves.
    result.repointed = reconciliation.repoint.length;
    result.deleted = reconciliation.deleteRowIds.length;
    result.flaggedStale = reconciliation.flagStaleRowIds.length;

    if (!dryRun) {
      const applied = await deps.store.applyReconciliation(reconciliation);
      result.written = applied.written;
      // A run that ran out of budget still wrote what it fetched, but it did
      // not cover every company — so it is recorded as failed, with why.
      await deps.store.finishJob({
        jobId: result.jobId as string,
        status: result.stoppedEarly ? "failed" : "completed",
        errorMessage: result.stoppedEarly ? stoppedEarlyMessage(result.stoppedEarly, input.fetchBudgetMs) : null,
        leadsIngested: applied.written,
      });
    }
  } catch (err) {
    result.error = stringifyError(err);
    if (!dryRun && result.jobId) {
      await deps.store.finishJob({
        jobId: result.jobId,
        status: "failed",
        errorMessage: result.error,
        leadsIngested: result.written,
      });
    }
  }

  result.fieldsSeen = [...fieldsSeen].sort();
  return result;
}

/**
 * Tallies parse failures by reason and keeps a bounded set of note SHAPES.
 *
 * Counts DISTINCT leads, not planned rows: one lead copied to three firms is
 * three rows but one failure, and tallying rows would report triple.
 */
function collectParseFailureDiagnostics(
  planned: readonly PlannedLead[],
  result: SourceResult,
): void {
  const seen = new Set<string>();
  for (const row of planned) {
    if (!row.parseFailed) continue;
    const key = leadKey(row.callrailId, row.personSuffix);
    if (seen.has(key)) continue;
    seen.add(key);

    // parseError is "<reason>" or "<reason>: <detail>", and the detail can
    // quote note text — so only the reason is ever carried out.
    const reason = (row.parseError ?? "unknown").split(":")[0].trim();
    result.parseFailureReasons[reason] =
      (result.parseFailureReasons[reason] ?? 0) + 1;

    if (result.noteStructures.length >= NOTE_STRUCTURE_SAMPLE_CAP) continue;
    result.noteStructures.push({
      source: row.source,
      callrailId: row.callrailId,
      reason,
      hasSemicolon: (row.rawNote ?? "").includes(";"),
      noteStructure: redactNoteStructure(row.rawNote),
    });
  }
}
