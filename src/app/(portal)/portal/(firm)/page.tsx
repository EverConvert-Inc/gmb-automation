import type { Metadata } from "next";
import Link from "next/link";
import { CircleAlert, Inbox } from "lucide-react";
import { NOTE_MAX_LENGTH, listVisibleLeads, type PortalLead } from "@/lib/portal/db";
import { allowedPortalWindow, presetOf, rangeFromSearchParams } from "@/lib/portal/range";
import { PORTAL_STATUS_TEXT, type PortalStatusLabel } from "@/lib/portal/visibility";
import { cn } from "@/lib/utils";
import { DateRangePicker } from "../../_components/date-range-picker";
import { formatPortalRange } from "../../_components/format";
import { LeadsView } from "../../_components/leads-view";
import { portalAccentText, portalButton } from "../../_components/ui";
import { requirePortalPage } from "../../_lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Leads" };

/**
 * The firm's leads for a date range inside the allowed window (range.ts):
 * the current or previous Eastern month, never a future day. Only fields of PortalLead are ever
 * rendered — db.ts selects no source, channel, tag or CallRail note, so there
 * is nothing else here to leak. The summary counts are taken from the same
 * list, so they need no query of their own.
 */
export default async function PortalLeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requirePortalPage();
  // Anything outside the window is refused here AND in listVisibleLeads; a
  // refused URL shows the default range, never the dates it asked for.
  const { range, invalid } = rangeFromSearchParams(await searchParams);
  const leads = await listVisibleLeads(session.firmId, range);

  const preset = presetOf(range);
  const allowed = allowedPortalWindow();
  const label = formatPortalRange(range, preset);
  const counts = countByStatus(leads);

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {label} · {leads.length} {leads.length === 1 ? "lead" : "leads"}
          </p>
        </div>
        <DateRangePicker from={range.from} to={range.to} min={allowed.min} max={allowed.max} preset={preset} />
      </div>

      {invalid && (
        <p role="status" className="flex items-center gap-2 rounded-lg border bg-card px-3.5 py-2.5 text-sm text-muted-foreground">
          <CircleAlert aria-hidden className="h-4 w-4 shrink-0" />
          That date range isn&apos;t available. Showing {label} instead.
        </p>
      )}

      <dl className="grid grid-cols-3 gap-3 sm:gap-4">
        {(["signed", "pending", "opportunity"] as const).map((s) => (
          <div key={s} className="rounded-xl border bg-card px-4 py-3 shadow-sm sm:px-5 sm:py-4">
            <dt className="flex items-center gap-2 text-xs font-medium text-muted-foreground sm:text-sm">
              <span aria-hidden className={`portal-summary-dot portal-summary-dot-${s}`} />
              {PORTAL_STATUS_TEXT[s]}
            </dt>
            <dd className="mt-1 font-display text-2xl font-bold tabular-nums sm:text-3xl">{counts[s]}</dd>
          </div>
        ))}
      </dl>

      {leads.length === 0 ? (
        <EmptyState label={label} showLastMonth={preset === "current"} />
      ) : (
        <LeadsView leads={leads} monthLabel={label} noteMaxLength={NOTE_MAX_LENGTH} />
      )}
    </div>
  );
}

function countByStatus(leads: readonly PortalLead[]): Record<PortalStatusLabel, number> {
  const counts: Record<PortalStatusLabel, number> = { signed: 0, pending: 0, opportunity: 0 };
  for (const lead of leads) counts[lead.status] += 1;
  return counts;
}

function EmptyState({ label, showLastMonth }: { label: string; showLastMonth: boolean }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed bg-card px-6 py-14 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Inbox aria-hidden className="h-6 w-6 text-muted-foreground" />
      </span>
      <p className="mt-4 font-display text-lg font-semibold">No leads for {label}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        New leads appear here as they come in.
      </p>
      {showLastMonth && (
        <Link href="/portal?month=previous" className={portalButton("secondary", "sm", cn("mt-5", portalAccentText))}>
          View last month
        </Link>
      )}
    </div>
  );
}
