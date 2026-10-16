import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  leadFirmCallrailCompanies,
  leadFirmTags,
  leadFirmUsers,
  leadFirms,
  leads,
} from "@/lib/db/schema";
import { ChevronRight } from "lucide-react";
import { FirmDetailsCard } from "@/components/leads/firm-details-card";
import { FirmStringListCard } from "@/components/leads/firm-string-list-card";
import { FirmUsersCard } from "@/components/leads/firm-users-card";
import { FirmDangerZoneCard } from "@/components/leads/firm-danger-zone-card";
import { FirmHeader } from "@/components/leads/firm-header";
import { FirmStatusStrip } from "@/components/leads/firm-status-strip";
import { FirmStep } from "@/components/leads/firm-step";
import { FirmSyncStep } from "@/components/leads/firm-sync-step";
import { queueCount, visibleNowCount } from "./_lib/firm-status";
import "./firm-page.css";

import { checkAdmin } from "@/lib/leads/admin-auth";
import { NotAuthorized } from "@/components/leads/not-authorized";
import { assertRow, assertRowShape } from "@/lib/leads/row-guard";

export const dynamic = "force-dynamic";

/**
 * The firm plus its lead count, as one query — the count rides along as a
 * correlated subquery rather than a separate round-trip. Only ever called
 * after the staff check.
 */
async function getFirm(id: string) {
  const rows = await db
    .select({
      id: leadFirms.id,
      name: leadFirms.name,
      slug: leadFirms.slug,
      isActive: leadFirms.isActive,
      leadCount: sql<number>`(select count(*)::int from ${leads} where ${leads.firmId} = ${leadFirms.id})`,
    })
    .from(leadFirms)
    .where(eq(leadFirms.id, id));
  const row = rows[0] ?? null;
  assertRow("admin/firms/[id]: firm", row, {
    id: "string",
    name: "string",
    slug: "string",
    isActive: "boolean",
    leadCount: "number",
  });
  return row;
}

// A fixed title, deliberately. generateMetadata runs as its own unit of work,
// separately from the page body, so a lookup here ran BEFORE the staff check
// below and put a firm's name in the tab title for any signed-in session. Nothing
// is read until checkAdmin() has passed.
export const metadata: Metadata = { title: "Firm" };

export default async function FirmDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Staff-only. The middleware gate cannot tell a staff member from a
  // client user, and this page reads across every firm.
  const auth = await checkAdmin();
  if (!auth.ok) {
    // A timed-out auth check is an outage, not a permissions answer: throw so
    // the error boundary says so instead of rendering "Not authorized".
    if (auth.status === 503) throw new Error(auth.error);
    return <NotAuthorized />;
  }

  const { id } = await params;
  const firm = await getFirm(id);
  if (!firm) notFound();

  // SEQUENTIAL. Each of these is a handful of rows; running them together
  // bought nothing and put four queries on a pool of five, which is what
  // let one response reach another query's promise.
  const tags = await db.query.leadFirmTags.findMany({
    where: eq(leadFirmTags.firmId, id),
    orderBy: asc(leadFirmTags.tagNameLower),
  });
  assertRowShape("admin/firms/[id]: tags", tags, {
    id: "string",
    tagName: "string",
    tagNameLower: "string",
  });

  const companies = await db.query.leadFirmCallrailCompanies.findMany({
    where: eq(leadFirmCallrailCompanies.firmId, id),
    orderBy: asc(leadFirmCallrailCompanies.callrailCompanyId),
  });
  assertRowShape("admin/firms/[id]: companies", companies, {
    id: "string",
    callrailCompanyId: "string",
  });

  const users = await db.query.leadFirmUsers.findMany({
    where: eq(leadFirmUsers.firmId, id),
    orderBy: asc(leadFirmUsers.email),
  });
  assertRowShape("admin/firms/[id]: users", users, {
    id: "string",
    email: "string",
    isActive: "boolean",
  });

  // Two more read-only counts for the status strip, after the others.
  const visibleNow = await visibleNowCount(id);
  const inQueue = await queueCount(id);

  const leadCount = firm.leadCount;
  const activeLogins = users.filter((u) => u.isActive).length;
  const companyIds = companies.map((c) => c.callrailCompanyId);

  return (
    <div className="firm-ui mx-auto max-w-4xl space-y-6">
      <Link href="/admin/firms" className="text-sm text-muted-foreground hover:underline">
        ← All firms
      </Link>

      <FirmHeader firm={{ id: firm.id, name: firm.name, slug: firm.slug, isActive: firm.isActive }} />

      <FirmStatusStrip
        status={{
          companiesMapped: companies.length,
          activeLogins,
          leadsSynced: leadCount,
          visibleNow,
          inQueue,
        }}
      />

      <FirmStep n={1} title="CallRail company" hint="Leads from this company route to this firm." done={companies.length > 0}>
        <FirmStringListCard
          firmId={firm.id}
          kind="companies"
          bodyKey="callrailCompanyId"
          addLabel="Or paste a company id"
          placeholder="COM…"
          emptyHint="No company mapped yet."
          initial={companies.map((c) => ({ id: c.id, value: c.callrailCompanyId }))}
          picker
        />
      </FirmStep>

      <FirmStep n={2} title="Client login" hint="People at the firm who can open the portal." done={activeLogins > 0}>
        <FirmUsersCard
          firmId={firm.id}
          firmActive={firm.isActive}
          users={users.map((u) => ({ id: u.id, email: u.email, isActive: u.isActive }))}
        />
      </FirmStep>

      <FirmStep n={3} title="Sync and review" hint="Pull this firm's leads from CallRail now." done={leadCount > 0}>
        <FirmSyncStep firmId={firm.id} companyIds={companyIds} queueCount={inQueue} />
      </FirmStep>

      <details className="group rounded-xl border bg-card shadow-sm" data-section="advanced">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 text-sm font-semibold sm:px-6 [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden className="h-4 w-4 transition-transform group-open:rotate-90" />
          Advanced
          <span className="font-normal text-muted-foreground">Name, slug and extra routing tags</span>
        </summary>
        <div className="space-y-6 border-t px-5 py-5 sm:px-6">
          <FirmDetailsCard firm={firm} />
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Extra routing tags</h3>
            <p className="text-sm text-muted-foreground">A lead with one of these CallRail tags routes here, whatever its company.</p>
            <FirmStringListCard
              firmId={firm.id}
              kind="tags"
              bodyKey="tagName"
              addLabel="Add a routing tag"
              placeholder="Smith Law"
              emptyHint="No extra tags."
              initial={tags.map((t) => ({ id: t.id, value: t.tagName }))}
            />
          </div>
        </div>
      </details>

      <details className="group rounded-xl border border-destructive/30 bg-card shadow-sm" data-section="danger">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 text-sm font-semibold text-destructive sm:px-6 [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden className="h-4 w-4 transition-transform group-open:rotate-90" />
          Danger zone
          <span className="font-normal text-muted-foreground">Delete this firm</span>
        </summary>
        <div className="border-t px-5 py-5 sm:px-6">
          <FirmDangerZoneCard firmId={firm.id} firmName={firm.name} leadCount={leadCount} />
        </div>
      </details>
    </div>
  );
}
