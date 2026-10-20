// The ONLY database path for portal code. Every function takes the session's
// firm id first — a SessionFirmId, which only requirePortalSession() produces
// — and never reads a firm id from its other arguments.
//
// Every query: runs through portalQuery (one at a time, 15s limit), returns
// rows keyed by column name, and is checked row by row for shape AND for
// firm_id equal to the session's firm. Rows from listVisibleLeads are also
// re-checked against the visibility and month rules in visibility.ts, so if
// the SQL and the rules ever disagree, this throws instead of rendering.

import { toIsoDateEastern } from "@/lib/date-utils";
import { portalQuery } from "./client";
import { assertFirmRows, PortalRowError } from "./guards";
import type { SessionFirmId } from "./types";
import {
  clientVisibility,
  clientVisibleSql,
  inRange,
  monthAnchor,
  negativeTagsSql,
  type ClientLabel,
} from "./visibility";
import { assertPortalRange, type PortalDateRange } from "./range";
import { STAFF_NAMED_SQL, hasUsableName, unusableNameSql } from "./usable-name";

type Sql = Parameters<Parameters<typeof portalQuery>[1]>[0];

export const PORTAL_LEAD_LIMIT = 500;
export const NOTE_MAX_LENGTH = 2000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The negative-tag list is written into the SQL as literals rather than bound
// as an array, so the query has no array-typed parameter to get wrong. A test
// checks these literals are exactly the negative tags, so the two cannot drift.
/** Pending or Signed with no negative tag, or approved (visibility.ts). */
const CLIENT_VISIBLE_SQL = clientVisibleSql("l");
/** The lead's negative tags, for the row re-check — keys only, never the tags. */
const NEGATIVE_TAGS_SQL = negativeTagsSql("l");

/** A placeholder name (usable-name.ts), over the lead's effective name. */
const UNUSABLE_NAME_SQL = unusableNameSql("coalesce(l.name_override, l.name_parsed)");

/**
 * The visibility rule for a lead aliased `l`, scoped to the session's firm.
 * Kept in ONE place so the list and the note insert can never disagree —
 * and the summary cards are counted from that same list.
 */
function visibleTo(sql: Sql, firmId: SessionFirmId) {
  return sql`
        l.firm_id = ${firmId}::uuid
    and l.needs_review = false
    and ${sql.unsafe(CLIENT_VISIBLE_SQL)}
    and (
          ${sql.unsafe(STAFF_NAMED_SQL)}
       or not ${sql.unsafe(UNUSABLE_NAME_SQL)}
    )`;
}

export type PortalLead = {
  id: string;
  /** The call date, Eastern, YYYY-MM-DD. */
  date: string;
  /** Always a usable name (usable-name.ts): leads without one are not shown. */
  name: string | null;
  phone: string | null;
  /** Signed or Pending — the only two a client sees (clientVisibility). */
  status: ClientLabel;
  /** Eastern date the lead was signed, when it is signed and the date is known. */
  signedDate: string | null;
  /**
   * The firm's own current note: the newest note written from the client
   * side of THIS firm. Notes are append-only; this is what the editable field
   * holds. Never the CallRail note.
   */
  firmNote: { body: string; date: string } | null;
  /** The newest note overall, only when staff wrote it — shown read-only. */
  staffNote: { body: string; date: string } | null;
};

/** The firm's visible leads for a range: at most PORTAL_LEAD_LIMIT of them. */
export async function listVisibleLeads(
  firmId: SessionFirmId,
  range: PortalDateRange,
): Promise<PortalLead[]> {
  return (await listVisibleLeadsCapped(firmId, range)).leads;
}

/**
 * The same ONE query, plus whether the range holds more than the limit: it
 * asks for one row past PORTAL_LEAD_LIMIT, so a range of exactly 500 is not
 * mistaken for a cut-off one. The extra row is checked like every other row
 * and then dropped, never shown.
 */
export async function listVisibleLeadsCapped(
  firmId: SessionFirmId,
  range: PortalDateRange,
): Promise<{ leads: PortalLead[]; reachedLimit: boolean }> {
  const all = await queryVisibleLeads(firmId, range);
  return { leads: all.slice(0, PORTAL_LEAD_LIMIT), reachedLimit: all.length > PORTAL_LEAD_LIMIT };
}

async function queryVisibleLeads(
  firmId: SessionFirmId,
  range: PortalDateRange,
): Promise<PortalLead[]> {
  // The window is enforced here too, not only where the URL is read.
  assertPortalRange(range);
  const label = "listVisibleLeads";

  const rows = await portalQuery(label, (sql) => sql`
    select
      l.id::text                                                      as id,
      l.firm_id::text                                                 as firm_id,
      l.occurred_at                                                   as occurred_at,
      l.signed_at                                                     as signed_at,
      coalesce(l.status_override, l.status_parsed)                    as effective_status,
      l.needs_review                                                  as needs_review,
      (l.status_override is not null)                                 as has_status_override,
      l.status_tag_matched                                            as status_tag_matched,
      -- Comma-joined text, never an array: this client does not parse arrays (client.ts).
      array_to_string(${sql.unsafe(NEGATIVE_TAGS_SQL)}, ',')           as negative_tags,
      l.client_approved_at                                            as client_approved_at,
      array_to_string(l.client_approved_negative_tags, ',')           as client_approved_negative_tags,
      coalesce(l.name_override, l.name_parsed)                        as name,
      ${sql.unsafe(STAFF_NAMED_SQL)}                                   as name_is_override,
      coalesce(l.phone_override, l.phone_parsed)                      as phone,
      ln.body                                                         as note_body,
      ln.created_at                                                   as note_created_at,
      ln.author_kind                                                  as note_author_kind,
      ln.firm_id::text                                                as note_firm_id,
      cn.body                                                         as client_note_body,
      cn.created_at                                                   as client_note_created_at,
      cn.firm_id::text                                                as client_note_firm_id
    from leads l
    left join lateral (
      select n.body, n.created_at, n.author_kind, n.firm_id
      from lead_notes n
      where n.lead_id = l.id
        and n.firm_id = ${firmId}::uuid
      order by n.created_at desc, n.id desc
      limit 1
    ) ln on true
    left join lateral (
      select n.body, n.created_at, n.firm_id
      from lead_notes n
      where n.lead_id = l.id
        and n.firm_id = ${firmId}::uuid
        and n.author_kind = 'client'
      order by n.created_at desc, n.id desc
      limit 1
    ) cn on true
    where ${visibleTo(sql, firmId)}
      and (case when coalesce(l.status_override, l.status_parsed) = 'signed'
                then coalesce(l.signed_at, l.occurred_at)
                else l.occurred_at end) >= ${range.start}::timestamptz
      and (case when coalesce(l.status_override, l.status_parsed) = 'signed'
                then coalesce(l.signed_at, l.occurred_at)
                else l.occurred_at end) <  ${range.endExclusive}::timestamptz
    order by l.occurred_at desc, l.id
    limit ${PORTAL_LEAD_LIMIT + 1}
  `);

  assertFirmRows(label, rows, firmId, {
    id: "string",
    occurred_at: "date",
    signed_at: "date?",
    effective_status: "string",
    needs_review: "boolean",
    has_status_override: "boolean",
    status_tag_matched: "string?",
    client_approved_at: "date?",
    negative_tags: "string",
    client_approved_negative_tags: "string",
    name: "string?",
    name_is_override: "boolean",
    phone: "string?",
    note_body: "string?",
    note_created_at: "date?",
    note_author_kind: "string?",
    note_firm_id: "string?",
    client_note_body: "string?",
    client_note_created_at: "date?",
    client_note_firm_id: "string?",
  });

  const leads = rows.map((r, i) => {
    // A note, when present, must belong to the session's firm too.
    if (r.note_body !== null && r.note_firm_id !== firmId) {
      throw new PortalRowError(label, i, "note_firm_id", "does not match the session");
    }
    if (r.client_note_body !== null && r.client_note_firm_id !== firmId) {
      throw new PortalRowError(label, i, "client_note_firm_id", "does not match the session");
    }
    const effectiveStatus = r.effective_status as string;
    const occurredAt = r.occurred_at as Date;
    const signedAt = (r.signed_at as Date | null) ?? null;

    // Second line of defence: re-apply the rules to what Postgres returned.
    const negativeTags = keyList(r.negative_tags as string);
    const approvedTags = keyList(r.client_approved_negative_tags as string);
    const visibility = clientVisibility({
      effectiveStatus,
      needsReview: r.needs_review as boolean,
      hasStatusOverride: r.has_status_override as boolean,
      statusTagMatched: (r.status_tag_matched as string | null) ?? null,
      negativeTags,
      clientApprovedAt: (r.client_approved_at as Date | null) ?? null,
      clientApprovedNegativeTags: approvedTags,
    });
    if (!visibility.visible) {
      throw new PortalRowError(label, i, "visibility", "returned a lead the rules hide");
    }
    if (!inRange(monthAnchor({ effectiveStatus, signedAt, occurredAt }), range)) {
      throw new PortalRowError(label, i, "month", `outside ${range.from}..${range.to}`);
    }

    const signed = effectiveStatus === "signed";
    const lead: PortalLead = {
      id: r.id as string,
      date: toIsoDateEastern(occurredAt),
      name: (r.name as string | null) ?? null,
      phone: (r.phone as string | null) ?? null,
      status: visibility.label,
      signedDate: signed && signedAt ? toIsoDateEastern(signedAt) : null,
      firmNote:
        r.client_note_body === null
          ? null
          : {
              body: r.client_note_body as string,
              date: toIsoDateEastern(r.client_note_created_at as Date),
            },
      staffNote:
        r.note_body === null || r.note_author_kind === "client"
          ? null
          : {
              body: r.note_body as string,
              date: toIsoDateEastern(r.note_created_at as Date),
            },
    };
    return lead;
  });

  // The name rule, re-applied in TypeScript. The SQL already hides these; a
  // row it let through is dropped here rather than failing the page — a
  // placeholder name is not a leak, so it needs no hard stop like the checks
  // above. The admin "visible now" count uses this same function.
  return leads.filter((_, i) =>
    hasUsableName({ name: (rows[i].name as string | null) ?? null, hasNameOverride: rows[i].name_is_override as boolean }),
  );
}

export type AddNoteResult =
  | { ok: true; note: { id: string; leadId: string; createdAt: Date } }
  | { ok: false; reason: "not_found" | "invalid_body" };

/**
 * One SQL statement: inserts only if the lead id matches AND the lead belongs
 * to the session's firm AND it is currently visible to that firm. No match —
 * including a lead that exists at another firm — is the same "not_found", so
 * the answer never reveals whether an id exists elsewhere. There is no
 * separate check-then-write, so there is no window between the two.
 */
export async function addClientNote(
  firmId: SessionFirmId,
  userId: string,
  email: string | null,
  leadId: string,
  body: string,
): Promise<AddNoteResult> {
  if (typeof body !== "string") return { ok: false, reason: "invalid_body" };
  const text = body.trim();
  // Rejected rather than truncated: a silently shortened note is worse than
  // an error the person can see and fix.
  if (text.length === 0 || text.length > NOTE_MAX_LENGTH) {
    return { ok: false, reason: "invalid_body" };
  }
  // A malformed id would otherwise reach Postgres as a cast error.
  if (typeof leadId !== "string" || !UUID.test(leadId)) {
    return { ok: false, reason: "not_found" };
  }

  const label = "addClientNote";
  const rows = await portalQuery(label, (sql) => sql`
    insert into lead_notes (lead_id, firm_id, author_kind, author_auth_user_id, author_email, body)
    select l.id, l.firm_id, 'client', ${userId}::uuid, ${email}::text, ${text}::text
    from leads l
    where l.id = ${leadId}::uuid
      and ${visibleTo(sql, firmId)}
    returning id::text as id, lead_id::text as lead_id, firm_id::text as firm_id, created_at
  `);

  if (rows.length === 0) return { ok: false, reason: "not_found" };
  if (rows.length > 1) throw new Error("addClientNote inserted more than one row.");
  assertFirmRows(label, rows, firmId, { id: "string", lead_id: "string", created_at: "date" });
  if (rows[0].lead_id !== leadId) {
    throw new PortalRowError(label, 0, "lead_id", "does not match the requested lead");
  }
  // leadId is the inserted row's, already checked equal to the requested one.
  return {
    ok: true,
    note: { id: rows[0].id as string, leadId: rows[0].lead_id as string, createdAt: rows[0].created_at as Date },
  };
}

/** Negative tag keys, comma-joined by the SQL (keys never contain a comma). */
function keyList(csv: string): string[] {
  return csv === "" ? [] : csv.split(",");
}
