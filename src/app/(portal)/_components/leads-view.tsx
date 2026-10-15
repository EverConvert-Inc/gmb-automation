"use client";

import { useMemo, useState } from "react";
import { Phone, Search, SearchX, X } from "lucide-react";
import type { PortalLead } from "@/lib/portal/db";
import { PORTAL_STATUS_TEXT, type PortalStatusLabel } from "@/lib/portal/visibility";
import { cn } from "@/lib/utils";
import { FILTER_STATUSES, filterLeads, isFiltered, statusFacets } from "../_lib/filter";
import { FacetedFilter } from "./faceted-filter";
import { formatPortalDate, formatPortalPhone } from "./format";
import { LeadNote } from "./lead-note";
import { StatusBadge } from "./status-badge";
import { portalButton, portalInput } from "./ui";

// The filter shows the same badges as the table's Status column.
const STATUS_OPTIONS = FILTER_STATUSES.map((s) => ({
  value: s,
  label: PORTAL_STATUS_TEXT[s],
  badge: <StatusBadge status={s} />,
}));

/**
 * The month's leads, with a status filter and a name/phone search. All of it
 * runs here, in the browser, over exactly the rows the server already sent
 * for this month — so it can show nothing the page did not already show.
 */
export function LeadsView({
  leads,
  monthLabel,
  noteMaxLength,
}: {
  leads: PortalLead[];
  monthLabel: string;
  noteMaxLength: number;
}) {
  const [statuses, setStatuses] = useState<Set<PortalStatusLabel>>(() => new Set());
  const [query, setQuery] = useState("");

  const filter = { statuses, query };
  const shown = useMemo(() => filterLeads(leads, { statuses, query }), [leads, statuses, query]);
  const counts = useMemo(() => statusFacets(leads, query), [leads, query]);
  const filtered = isFiltered(filter);

  function reset() {
    setStatuses(new Set());
    setQuery("");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or phone"
            aria-label="Search leads by name or phone"
            autoComplete="off"
            className={cn(portalInput, "h-9 py-1.5 pl-9")}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FacetedFilter
            title="Status"
            options={STATUS_OPTIONS}
            selected={statuses}
            counts={counts}
            onChange={setStatuses}
          />
          {filtered && (
            <button type="button" onClick={reset} className={portalButton("ghost", "sm", "h-9")}>
              Reset
              <X aria-hidden className="h-4 w-4" />
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground sm:ml-auto" aria-live="polite">
          {filtered ? `Showing ${shown.length} of ${leads.length}` : null}
        </p>
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed bg-card px-6 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <SearchX aria-hidden className="h-6 w-6 text-muted-foreground" />
          </span>
          <p className="mt-4 font-display text-lg font-semibold">No leads match your filters</p>
          <p className="mt-1 text-sm text-muted-foreground">Try a different search or status.</p>
          <button type="button" onClick={reset} className={portalButton("secondary", "sm", "mt-5")}>
            Clear filters
          </button>
        </div>
      ) : (
        <>
          {/* Desktop and tablet: a table. */}
          <div className="hidden overflow-hidden rounded-xl border bg-card shadow-sm md:block">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Leads for {monthLabel}</caption>
              <thead className="border-b bg-muted/50">
                <tr className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-5 py-3">Date</th>
                  <th scope="col" className="px-5 py-3">Name</th>
                  <th scope="col" className="px-5 py-3">Phone</th>
                  <th scope="col" className="px-5 py-3">Status</th>
                  <th scope="col" className="w-[38%] px-5 py-3">Latest note</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {shown.map((lead) => (
                  <LeadRow key={lead.id} lead={lead} noteMaxLength={noteMaxLength} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Phone: one card per lead. */}
          <ul className="space-y-3 md:hidden" aria-label={`Leads for ${monthLabel}`}>
            {shown.map((lead) => (
              <LeadCard key={lead.id} lead={lead} noteMaxLength={noteMaxLength} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Plain text, deliberately not a tel: link. */
function PhoneText({ phone }: { phone: string | null }) {
  return (
    <span className={cn("tabular-nums", phone ? "text-foreground" : "text-muted-foreground")}>
      {formatPortalPhone(phone)}
    </span>
  );
}

function LeadRow({ lead, noteMaxLength }: { lead: PortalLead; noteMaxLength: number }) {
  return (
    <tr className="align-top transition-colors hover:bg-muted/40">
      <td className="whitespace-nowrap px-5 py-4 tabular-nums text-muted-foreground">{formatPortalDate(lead.date)}</td>
      <td className="px-5 py-4 font-medium text-foreground">
        {lead.name ?? <span className="font-normal text-muted-foreground">—</span>}
      </td>
      <td className="whitespace-nowrap px-5 py-4">
        <PhoneText phone={lead.phone} />
      </td>
      <td className="whitespace-nowrap px-5 py-4">
        <StatusBadge status={lead.status} />
      </td>
      <td className="px-5 py-4">
        <LeadNote leadId={lead.id} firmNote={lead.firmNote} staffNote={lead.staffNote} maxLength={noteMaxLength} />
      </td>
    </tr>
  );
}

function LeadCard({ lead, noteMaxLength }: { lead: PortalLead; noteMaxLength: number }) {
  return (
    <li className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-foreground">{lead.name ?? "No name"}</p>
          <p className="mt-0.5 text-sm tabular-nums text-muted-foreground">{formatPortalDate(lead.date)}</p>
        </div>
        <StatusBadge status={lead.status} />
      </div>
      <p className="mt-3 flex items-center gap-2 text-sm">
        <Phone aria-hidden className="h-4 w-4 text-muted-foreground" />
        <PhoneText phone={lead.phone} />
      </p>
      <div className="mt-4 border-t pt-4">
        <LeadNote leadId={lead.id} firmNote={lead.firmNote} staffNote={lead.staffNote} maxLength={noteMaxLength} />
      </div>
    </li>
  );
}

