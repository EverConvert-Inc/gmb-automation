// Soft duplicate detection, at sync time.
//
// Pure: the caller supplies the rows it is about to write and the phones
// already on file for the firms involved.
//
// Deliberately NOT a database constraint. A unique index over
// coalesce(phone_override, phone_parsed) would be an expression index over
// admin-mutable columns: a collision would throw mid-sync and fail the whole
// firm's ingestion, and it could not see the multi-person carve-out below.
// Flagging keeps the lead and asks a human.

import { normalizePhoneDigits } from "./parse-note";
import type { PlannedLead } from "./types";

export type FirmPhoneRow = {
  leadId: string;
  firmId: string;
  callrailId: string;
  /** The effective phone, exactly as stored. Normalised here, not in SQL. */
  phone: string | null;
};

/**
 * Normalised through the same helper the parser uses, so "(555) 123-4567"
 * and "+1 555.123.4567 ext 2" compare equal to "5551234567". Doing this in
 * SQL instead would drift: Postgres has no cheap way to strip an extension,
 * so right(digits, 10) would read "5551234567 ext 12" as "5123456712".
 */
function phoneKey(phone: string | null): string | null {
  if (!phone) return null;
  const digits = normalizePhoneDigits(phone);
  return digits.length >= 7 ? digits : null;
}

export type DedupResult = {
  rows: PlannedLead[];
  flagged: number;
};

export function flagPossibleDuplicates(
  planned: readonly PlannedLead[],
  existing: readonly FirmPhoneRow[],
): DedupResult {
  // firmId -> phoneKey -> the lead already holding it.
  const index = new Map<string, Map<string, FirmPhoneRow>>();
  for (const row of existing) {
    const key = phoneKey(row.phone);
    if (!key) continue;
    const byPhone = index.get(row.firmId) ?? new Map<string, FirmPhoneRow>();
    if (!byPhone.has(key)) byPhone.set(key, row);
    index.set(row.firmId, byPhone);
  }

  let flagged = 0;
  const rows = planned.map((row) => {
    if (!row.firmId) return row;
    const key = phoneKey(row.phoneParsed);
    if (!key) return row;

    const match = index.get(row.firmId)?.get(key);
    if (!match) return row;

    // Its own stored row is not a duplicate of itself, and neither is a
    // sibling split from the SAME multi-person note — one note naming two
    // people who share a phone is one household, not two leads filed twice.
    if (match.callrailId === row.callrailId) return row;

    flagged += 1;
    return {
      ...row,
      possibleDuplicateOf: match.leadId,
      // Surfaced in the admin queue. Never blocks the write.
      needsReview: true,
    };
  });

  return { rows, flagged };
}

/** Firms touched by this run, for scoping the phone lookup. */
export function firmIdsIn(planned: readonly PlannedLead[]): string[] {
  const out = new Set<string>();
  for (const row of planned) if (row.firmId) out.add(row.firmId);
  return [...out];
}
