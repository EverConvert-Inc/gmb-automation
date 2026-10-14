// Firm resolution for the client-facing lead tracker.
//
// Pure: the caller passes in the lead_firm_tags and
// lead_firm_callrail_companies rows it already read, and gets back which
// firms the lead belongs to. No DB, no network, no imports.
//
// This is the single most leak-prone decision in the tracker — it is what
// decides which law firm sees a person's name and phone number. The rules
// are therefore kept narrow on purpose: whole-string tag matching only, and
// an ambiguous company mapping routes to the admin queue rather than
// guessing.

export type FirmTagRule = { firmId: string; tagName: string };
export type FirmCompanyRule = { firmId: string; callrailCompanyId: string };

export type RoutingIndex = {
  firmIdsByTag: ReadonlyMap<string, readonly string[]>;
  firmIdByCompany: ReadonlyMap<string, string>;
  /**
   * Company ids mapped to more than one firm. The DB forbids this
   * (lead_firm_callrail_companies.callrail_company_id is UNIQUE), so a
   * non-empty list means something bypassed the constraint — worth alerting
   * on. Leads for these companies are routed to the admin queue, never to a
   * guessed firm.
   */
  conflictingCompanyIds: readonly string[];
};

export type RoutingDecision = {
  /** Empty means the admin queue (leads.firm_id null, needs_review true). */
  firmIds: string[];
  matchedBy: "tag" | "company" | "unassigned";
  /** Which of the lead's tags matched a firm, as written on the lead. */
  matchedTags: string[];
};

// Exact match ignoring case, per spec — never partial. Internal whitespace
// is collapsed so "Smith  Law" and "smith law" match, but "Smith" can never
// match "Smith Law", which is the failure mode that would copy one firm's
// leads to another.
function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function buildRoutingIndex(
  tagRules: readonly FirmTagRule[],
  companyRules: readonly FirmCompanyRule[],
): RoutingIndex {
  const firmIdsByTag = new Map<string, string[]>();
  for (const rule of tagRules) {
    const key = normalize(rule.tagName);
    if (!key || !rule.firmId) continue;
    const list = firmIdsByTag.get(key) ?? [];
    // A firm listing the same tag twice must not get two copies of the lead.
    if (!list.includes(rule.firmId)) list.push(rule.firmId);
    firmIdsByTag.set(key, list);
  }

  const firmIdByCompany = new Map<string, string>();
  const conflicting = new Set<string>();
  for (const rule of companyRules) {
    const key = rule.callrailCompanyId?.trim();
    if (!key || !rule.firmId) continue;
    const existing = firmIdByCompany.get(key);
    if (existing !== undefined && existing !== rule.firmId) {
      conflicting.add(key);
      continue;
    }
    firmIdByCompany.set(key, rule.firmId);
  }

  return {
    firmIdsByTag,
    firmIdByCompany,
    conflictingCompanyIds: [...conflicting],
  };
}

export function resolveFirmsForLead(
  lead: {
    tags?: readonly (string | null | undefined)[] | null;
    callrailCompanyId?: string | null;
  },
  index: RoutingIndex,
): RoutingDecision {
  // Rule 1 — any tag matching a firm. A tag matching several firms copies
  // the lead to each of them, and a lead carrying several matching tags
  // likewise lands at every firm, deduped. Order follows the lead's own tag
  // order so the result is deterministic.
  const firmIds: string[] = [];
  const matchedTags: string[] = [];
  for (const tag of lead.tags ?? []) {
    if (typeof tag !== "string") continue;
    const hits = index.firmIdsByTag.get(normalize(tag));
    if (!hits || hits.length === 0) continue;
    matchedTags.push(tag);
    for (const firmId of hits) {
      if (!firmIds.includes(firmId)) firmIds.push(firmId);
    }
  }
  if (firmIds.length > 0) return { firmIds, matchedBy: "tag", matchedTags };

  // Rule 2 — the firm mapped to the lead's CallRail company.
  const companyId = lead.callrailCompanyId?.trim();
  if (companyId && !index.conflictingCompanyIds.includes(companyId)) {
    const firmId = index.firmIdByCompany.get(companyId);
    if (firmId) {
      return { firmIds: [firmId], matchedBy: "company", matchedTags: [] };
    }
  }

  // Rule 3 — the admin queue.
  return { firmIds: [], matchedBy: "unassigned", matchedTags: [] };
}
