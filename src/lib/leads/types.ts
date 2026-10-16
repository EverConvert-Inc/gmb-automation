// Shared shapes for the lead tracker's ingestion, split out so sync.ts and
// store.ts can both reference them without importing each other.

export type LeadSource = "call" | "form";

/** The identity of one person on one CallRail record, firm-independent. */
export function leadKey(callrailId: string, personSuffix: string): string {
  return `${callrailId}|${personSuffix}`;
}
export type LeadStatus = "pending" | "signed";

/** A CallRail record normalised into the shape the planner understands. */
export type TrackerLead = {
  source: LeadSource;
  callrailId: string;
  callrailCompanyId: string;
  occurredAt: Date;
  tags: string[];
  note: string | null;
  customerName: string | null;
  customerPhoneNumber: string | null;
  rawSourceName: string | null;
  rawTrackerId: string | null;
  rawFormData: Record<string, unknown> | null;
};

/**
 * One planned `leads` row. Every field here is SYNC-OWNED: there is
 * deliberately no name_override, phone_override, status_override or
 * is_opportunity_override on this type, so an admin's hand edit cannot be
 * reached by the writer even by mistake. That is the mechanism behind
 * "admin overrides are never overwritten" — not a rule the writer remembers
 * to follow, but a field it has no way to name.
 */
export type PlannedLead = {
  /** Null means the admin queue. */
  firmId: string | null;
  source: LeadSource;
  callrailId: string;
  personSuffix: string;
  callrailCompanyId: string;
  occurredAt: Date;
  rawSourceName: string | null;
  rawTrackerId: string | null;
  rawNote: string | null;
  rawTags: string[];
  rawFormData: Record<string, unknown> | null;
  customerPhoneCallerid: string | null;
  nameParsed: string | null;
  phoneParsed: string | null;
  statusParsed: LeadStatus;
  statusTagMatched: string | null;
  isOpportunityParsed: boolean;
  suggestedStatus: LeadStatus;
  parseFailed: boolean;
  parseError: string | null;
  needsReview: boolean;
  /**
   * Soft dedup, set at sync time: another lead at the SAME firm already has
   * this effective phone. Never enforced by a constraint — see dedup.ts.
   */
  possibleDuplicateOf: string | null;
  /**
   * Set when this person reads as signed. Applied only if the stored value
   * is still null — the webhook's receipt time is the true sign moment and
   * must never be replaced by a later sync's clock.
   */
  signedAt: Date | null;
};

export type JobKind = "callrail_calls" | "callrail_forms";

export type LeadStore = {
  loadRoutingRules(): Promise<{
    tagRules: { firmId: string; tagName: string }[];
    companyRules: { firmId: string; callrailCompanyId: string }[];
  }>;

  /**
   * CallRail ids of leads that fall in the given Eastern date range and are
   * STILL pending, by effective status (override first, then parsed).
   */
  findPendingCallrailIds(
    fromIsoEastern: string,
    toIsoEastern: string,
    source: LeadSource,
  ): Promise<Set<string>>;

  /**
   * Every row already held for these callrail ids, across all firms and the
   * unassigned slot, with enough detail to decide whether a surplus row
   * carries human work. Feeds reconcileLeadRows.
   */
  findExistingLeadRows(
    callrailIds: readonly string[],
  ): Promise<import("./reconcile").ExistingLeadRow[]>;

  /**
   * Applies a reconciliation plan. Repoints must land in the same
   * transaction as the upserts they make room for — a crash between the two
   * is exactly the duplicate this whole mechanism exists to prevent.
   */
  applyReconciliation(
    plan: import("./reconcile").ReconcilePlan,
  ): Promise<{ written: number; repointed: number; deleted: number; flagged: number }>;

  /** Effective phones already on file for these firms, for soft dedup. */
  findFirmPhoneIndex(
    firmIds: readonly string[],
  ): Promise<import("./dedup").FirmPhoneRow[]>;

  startJob(input: { kind: JobKind; triggeredBy: string; fromDate: string; toDate: string }): Promise<string>;

  finishJob(input: {
    jobId: string;
    status: "completed" | "failed";
    errorMessage: string | null;
    leadsIngested: number;
  }): Promise<void>;

  /**
   * Marks every job still 'running' that started before `startedBefore` as
   * 'failed' with `message`. A run killed at the function's time limit never
   * reaches its own finishJob, so without this its row says "running" forever.
   * Returns how many rows it changed.
   */
  failStaleJobs(input: { startedBefore: Date; message: string }): Promise<number>;

  /**
   * The to_date (an Eastern calendar date) of the most recent COMPLETED job
   * of this kind, or null if there is none. A run that stopped early or
   * failed does not count, so the next run reaches back past it.
   */
  lastCompletedJobToDate(kind: JobKind): Promise<string | null>;
};
