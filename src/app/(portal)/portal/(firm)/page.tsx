import type { Metadata } from "next";
import Link from "next/link";
import { Inbox, Phone } from "lucide-react";
import { NOTE_MAX_LENGTH, listVisibleLeads, type PortalLead } from "@/lib/portal/db";
import {
  PORTAL_STATUS_TEXT,
  isPortalMonth,
  portalMonthRange,
  type PortalMonth,
  type PortalStatusLabel,
} from "@/lib/portal/visibility";
import { cn } from "@/lib/utils";
import { formatPortalDate, formatPortalMonth, formatPortalPhone } from "../../_components/format";
import { LeadNote } from "../../_components/lead-note";
import { StatusBadge } from "../../_components/status-badge";
import { portalAccentText, portalButton, portalFocus } from "../../_components/ui";
import { requirePortalPage } from "../../_lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Leads" };

/**
 * The firm's leads for one Eastern month. Only fields of PortalLead are ever
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
  const raw = (await searchParams).month;
  const month: PortalMonth = isPortalMonth(raw) ? raw : "current";
  const leads = await listVisibleLeads(session.firmId, month);

  const label = formatPortalMonth(portalMonthRange(month).key);
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
        <nav aria-label="Month" className="inline-flex w-fit rounded-lg border bg-card p-1 shadow-sm">
          <MonthLink month="current" active={month === "current"}>
            This month
          </MonthLink>
          <MonthLink month="previous" active={month === "previous"}>
            Last month
          </MonthLink>
        </nav>
      </div>

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
        <EmptyState label={label} month={month} />
      ) : (
        <>
          {/* Desktop and tablet: a table. */}
          <div className="hidden overflow-hidden rounded-xl border bg-card shadow-sm md:block">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Leads for {label}</caption>
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
                {leads.map((lead) => (
                  <LeadRow key={lead.id} lead={lead} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Phone: one card per lead. */}
          <ul className="space-y-3 md:hidden" aria-label={`Leads for ${label}`}>
            {leads.map((lead) => (
              <LeadCard key={lead.id} lead={lead} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function countByStatus(leads: readonly PortalLead[]): Record<PortalStatusLabel, number> {
  const counts: Record<PortalStatusLabel, number> = { signed: 0, pending: 0, opportunity: 0 };
  for (const lead of leads) counts[lead.status] += 1;
  return counts;
}

function telHref(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.replace(/\D/g, "").length >= 7 ? `tel:${digits}` : null;
}

function PhoneLink({ phone }: { phone: string | null }) {
  const href = telHref(phone);
  const text = formatPortalPhone(phone);
  if (!href) return <span className="text-muted-foreground">{text}</span>;
  return (
    <a
      href={href}
      className={cn("rounded tabular-nums text-foreground underline-offset-4 hover:underline", portalFocus)}
    >
      {text}
    </a>
  );
}

function LeadRow({ lead }: { lead: PortalLead }) {
  return (
    <tr className="align-top transition-colors hover:bg-muted/40">
      <td className="whitespace-nowrap px-5 py-4 tabular-nums text-muted-foreground">{formatPortalDate(lead.date)}</td>
      <td className="px-5 py-4 font-medium text-foreground">
        {lead.name ?? <span className="font-normal text-muted-foreground">—</span>}
      </td>
      <td className="whitespace-nowrap px-5 py-4">
        <PhoneLink phone={lead.phone} />
      </td>
      <td className="whitespace-nowrap px-5 py-4">
        <StatusBadge status={lead.status} />
      </td>
      <td className="px-5 py-4">
        <LeadNote leadId={lead.id} latestNote={lead.latestNote} maxLength={NOTE_MAX_LENGTH} />
      </td>
    </tr>
  );
}

function LeadCard({ lead }: { lead: PortalLead }) {
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
        <PhoneLink phone={lead.phone} />
      </p>
      <div className="mt-4 border-t pt-4">
        <LeadNote leadId={lead.id} latestNote={lead.latestNote} maxLength={NOTE_MAX_LENGTH} />
      </div>
    </li>
  );
}

function EmptyState({ label, month }: { label: string; month: PortalMonth }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed bg-card px-6 py-14 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Inbox aria-hidden className="h-6 w-6 text-muted-foreground" />
      </span>
      <p className="mt-4 font-display text-lg font-semibold">No leads for {label}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        New leads appear here as they come in.
      </p>
      {month === "current" && (
        <Link href="/portal?month=previous" className={portalButton("secondary", "sm", cn("mt-5", portalAccentText))}>
          View last month
        </Link>
      )}
    </div>
  );
}

function MonthLink({
  month,
  active,
  children,
}: {
  month: PortalMonth;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={month === "current" ? "/portal" : "/portal?month=previous"}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors",
        portalFocus,
        active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
