import type { Metadata } from "next";
import Link from "next/link";
import { NOTE_MAX_LENGTH, listVisibleLeads, type PortalLead } from "@/lib/portal/db";
import { isPortalMonth, portalMonthRange, type PortalMonth } from "@/lib/portal/visibility";
import { formatPortalDate, formatPortalMonth, formatPortalPhone } from "../../_components/format";
import { LeadNote } from "../../_components/lead-note";
import { requirePortalPage } from "../../_lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Leads" };

/**
 * The firm's leads for one Eastern month. Only fields of PortalLead are ever
 * rendered — db.ts selects no source, channel, tag or CallRail note, so there
 * is nothing else here to leak.
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Leads</h1>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
        <nav aria-label="Month" className="inline-flex rounded-md border p-0.5 text-sm">
          <MonthLink month="current" active={month === "current"}>
            This month
          </MonthLink>
          <MonthLink month="previous" active={month === "previous"}>
            Last month
          </MonthLink>
        </nav>
      </div>

      {leads.length === 0 ? (
        <div className="rounded-lg border px-4 py-12 text-center">
          <p className="font-medium">No leads for {label}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            New leads appear here as they come in.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Latest note</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {leads.map((lead) => (
                <LeadRow key={lead.id} lead={lead} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LeadRow({ lead }: { lead: PortalLead }) {
  return (
    <tr className="align-top">
      <td className="whitespace-nowrap px-4 py-3">{formatPortalDate(lead.date)}</td>
      <td className="px-4 py-3">{lead.name ?? <span className="text-muted-foreground">—</span>}</td>
      <td className="whitespace-nowrap px-4 py-3">{formatPortalPhone(lead.phone)}</td>
      <td className="whitespace-nowrap px-4 py-3">
        {lead.status === "signed" ? (
          <span className="inline-flex flex-col">
            <span className="w-fit rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">
              Signed
            </span>
            {lead.signedDate && (
              <span className="mt-1 text-xs text-muted-foreground">
                Signed {formatPortalDate(lead.signedDate)}
              </span>
            )}
          </span>
        ) : (
          <span className="rounded-md bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-300">
            Opportunity
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <LeadNote leadId={lead.id} latestNote={lead.latestNote} maxLength={NOTE_MAX_LENGTH} />
      </td>
    </tr>
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
      className={
        active
          ? "rounded px-3 py-1 font-medium bg-secondary text-secondary-foreground"
          : "rounded px-3 py-1 text-muted-foreground hover:text-foreground"
      }
    >
      {children}
    </Link>
  );
}
