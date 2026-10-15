// Reconciles what routing says NOW against the lead rows that already exist.
//
// Pure: no DB, no network. The sync loads the existing rows, this decides
// what to do with them, and the store applies the result in a transaction.
//
// The problem it solves: the two uniqueness rules on `leads` cannot see each
// other. UNIQUE(firm_id, callrail_id, person_suffix) does not constrain rows
// whose firm_id is null, and the partial UNIQUE(callrail_id, person_suffix)
// WHERE firm_id IS NULL does not constrain rows that have a firm. So letting
// the sync simply insert a newly-routed lead leaves the old admin-queue row
// sitting beside it, and every unassigned lead in the table doubles the
// moment firms are configured.
//
// The answer is to REPOINT an existing row rather than insert a new one and
// delete the old. That is not just tidier: lead_notes.lead_id is ON DELETE
// CASCADE, so deleting a lead row silently takes its staff notes with it,
// and the *_override columns live on that same row. A lead sitting in the
// queue for a week may well have both by the time routing catches up.

import type { PlannedLead } from "./types";
import { leadKey } from "./types";

export type ExistingLeadRow = {
  id: string;
  firmId: string | null;
  callrailId: string;
  personSuffix: string;
  /** Any of the *_override columns is set. */
  hasOverrides: boolean;
  /** At least one lead_notes row points at it. */
  hasNotes: boolean;
};

export type Repoint = {
  rowId: string;
  fromFirmId: string | null;
  toFirmId: string | null;
  callrailId: string;
  personSuffix: string;
};

export type ReconcilePlan = {
  /** Applied BEFORE the upserts, so the upsert then matches the moved row. */
  repoint: Repoint[];
  upsert: PlannedLead[];
  /** Surplus rows carrying no human work — nothing is lost by removing them. */
  deleteRowIds: string[];
  /**
   * Surplus rows that DO carry human work. Kept, with needs_review set, which
   * removes them from client visibility while leaving them in the admin
   * queue for someone to decide. Nothing is destroyed.
   */
  flagStaleRowIds: string[];
};

/** Map key for a firm slot, since null is a meaningful value here. */
const NULL_FIRM = "\u0000unassigned";
const firmKey = (firmId: string | null) => firmId ?? NULL_FIRM;
const unFirmKey = (key: string): string | null => (key === NULL_FIRM ? null : key);

export function reconcileLeadRows(
  planned: readonly PlannedLead[],
  existing: readonly ExistingLeadRow[],
): ReconcilePlan {
  const plan: ReconcilePlan = {
    repoint: [],
    upsert: [...planned],
    deleteRowIds: [],
    flagStaleRowIds: [],
  };

  // Group both sides by the person's identity, which is firm-independent.
  const plannedByPerson = new Map<string, PlannedLead[]>();
  for (const row of planned) {
    const key = leadKey(row.callrailId, row.personSuffix);
    const list = plannedByPerson.get(key) ?? [];
    list.push(row);
    plannedByPerson.set(key, list);
  }
  const existingByPerson = new Map<string, ExistingLeadRow[]>();
  for (const row of existing) {
    const key = leadKey(row.callrailId, row.personSuffix);
    const list = existingByPerson.get(key) ?? [];
    list.push(row);
    existingByPerson.set(key, list);
  }

  for (const [key, plannedRows] of plannedByPerson) {
    const existingRows = existingByPerson.get(key) ?? [];
    if (existingRows.length === 0) continue; // all inserts, nothing to move

    // Target order follows the planner's order, which follows the lead's own
    // tag order deduped — so which row gets repointed is deterministic and a
    // re-run cannot flip-flop.
    const targetKeys = plannedRows.map((r) => firmKey(r.firmId));
    const targetSet = new Set(targetKeys);

    const existingByFirm = new Map<string, ExistingLeadRow>();
    for (const row of existingRows) existingByFirm.set(firmKey(row.firmId), row);

    const missing = targetKeys.filter((t) => !existingByFirm.has(t));
    // The unassigned row is paired first: it has the weakest claim to its
    // slot, so promoting it preserves the most history overall.
    const surplus = [...existingByFirm.entries()]
      .filter(([k]) => !targetSet.has(k))
      .sort((a, b) => Number(b[0] === NULL_FIRM) - Number(a[0] === NULL_FIRM))
      .map(([, row]) => row);

    const pairs = Math.min(surplus.length, missing.length);
    for (let i = 0; i < pairs; i += 1) {
      const row = surplus[i];
      const toFirmId = unFirmKey(missing[i]);
      plan.repoint.push({
        rowId: row.id,
        fromFirmId: row.firmId,
        toFirmId,
        callrailId: row.callrailId,
        personSuffix: row.personSuffix,
      });
    }

    // Whatever is left over has no slot to move into: this firm genuinely
    // lost the lead and no other firm gained it in the same breath.
    for (const row of surplus.slice(pairs)) {
      if (row.hasOverrides || row.hasNotes) {
        plan.flagStaleRowIds.push(row.id);
      } else {
        plan.deleteRowIds.push(row.id);
      }
    }
  }

  return plan;
}

/**
 * Why a row sits in the admin queue, derived rather than stored.
 *
 * needs_review means exactly one thing: HIDDEN FROM CLIENTS. Three causes set
 * it — a parse failure, no firm, or stale routing. A possible duplicate does
 * not: it is a heads-up for staff on a lead the firm still sees, carried by
 * possible_duplicate_of alone.
 *
 * Order matters. Stale routing is checked BEFORE duplicates, so a row that is
 * both is labelled by the reason that hides it — a stale row must never read
 * as a mere duplicate. Returns null for a row that needs nobody.
 */
export type QueueReason =
  | "parse_failure"
  | "unassigned"
  | "possible_duplicate"
  | "stale_routing";

export function queueReason(row: {
  parseFailed: boolean;
  firmId: string | null;
  needsReview: boolean;
  possibleDuplicateOf: string | null;
}): QueueReason | null {
  if (row.parseFailed) return "parse_failure";
  if (row.firmId === null) return "unassigned";
  // Firm set, note parsed, still hidden: the only remaining cause is stale
  // routing (reconcileLeadRows' flag on a surplus row someone had touched).
  if (row.needsReview) return "stale_routing";
  if (row.possibleDuplicateOf) return "possible_duplicate";
  return null;
}

export const QUEUE_REASON_LABELS: Record<QueueReason, string> = {
  parse_failure: "Note did not parse",
  unassigned: "No firm matched",
  possible_duplicate: "Possible duplicate",
  stale_routing: "Firm no longer matches routing",
};
