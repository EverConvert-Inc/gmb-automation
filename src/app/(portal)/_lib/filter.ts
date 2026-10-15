// Client-side filtering for the portal's leads table. Pure, and it works
// ONLY on the rows the page already loaded for the selected month — no
// query, no extra field. Same semantics as the shadcn "data table faceted
// filter": statuses selected in the filter match with OR, the search box
// combines with AND, and each status's count is taken after the search is
// applied but before the status filter itself.

import type { PortalStatusLabel } from "@/lib/portal/visibility";

/** The fields filtering may read: what the table already shows, nothing more. */
export type FilterableLead = {
  name: string | null;
  phone: string | null;
  status: PortalStatusLabel;
};

export type LeadFilter = {
  statuses: ReadonlySet<PortalStatusLabel>;
  query: string;
};

export const FILTER_STATUSES: readonly PortalStatusLabel[] = ["signed", "pending", "opportunity"];

const digitsOf = (s: string) => s.replace(/\D/g, "");

/**
 * Name: case-insensitive "contains", whitespace collapsed. Phone: compared
 * on digits only, so "(555) 123", "555-123" and "555123" all match. An empty
 * query matches everything.
 */
export function matchesSearch(lead: FilterableLead, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return true;
  const name = (lead.name ?? "").toLowerCase().replace(/\s+/g, " ");
  if (name.includes(q)) return true;
  const qDigits = digitsOf(q);
  // Only a query that is mostly a number is treated as a phone search, so
  // "Jo 2" does not match every phone containing a 2.
  if (qDigits.length >= 2 && qDigits.length >= q.replace(/[\s()+.-]/g, "").length) {
    return digitsOf(lead.phone ?? "").includes(qDigits);
  }
  return false;
}

export function matchesFilter(lead: FilterableLead, filter: LeadFilter): boolean {
  const statusOk = filter.statuses.size === 0 || filter.statuses.has(lead.status);
  return statusOk && matchesSearch(lead, filter.query);
}

export function filterLeads<T extends FilterableLead>(leads: readonly T[], filter: LeadFilter): T[] {
  return leads.filter((l) => matchesFilter(l, filter));
}

/** Count per status among the rows that pass the SEARCH (not the status filter). */
export function statusFacets(
  leads: readonly FilterableLead[],
  query: string,
): Record<PortalStatusLabel, number> {
  const counts: Record<PortalStatusLabel, number> = { signed: 0, pending: 0, opportunity: 0 };
  for (const lead of leads) if (matchesSearch(lead, query)) counts[lead.status] += 1;
  return counts;
}

export function isFiltered(filter: LeadFilter): boolean {
  return filter.statuses.size > 0 || filter.query.trim().length > 0;
}
