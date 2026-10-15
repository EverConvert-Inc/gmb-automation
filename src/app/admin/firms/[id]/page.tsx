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
import { FirmDetailsCard } from "@/components/leads/firm-details-card";
import { FirmStringListCard } from "@/components/leads/firm-string-list-card";
import { FirmUsersCard } from "@/components/leads/firm-users-card";
import { FirmDangerZoneCard } from "@/components/leads/firm-danger-zone-card";

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

  const leadCount = firm.leadCount;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <Link
          href="/admin/firms"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← All firms
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{firm.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {leadCount} lead{leadCount === 1 ? "" : "s"} currently routed here.
        </p>
      </div>

      <FirmDetailsCard firm={firm} />

      <FirmStringListCard
        firmId={firm.id}
        kind="tags"
        bodyKey="tagName"
        title="Routing tags"
        description="A lead carrying any of these CallRail tags routes to this firm. Matched whole, ignoring case — never partially, so “Smith” will not match “Smith Law”. A tag shared with another firm copies the lead to both."
        addLabel="Add a routing tag"
        placeholder="Smith Law"
        emptyHint="No routing tags. This firm only receives leads through its CallRail company mappings below."
        initial={tags.map((t) => ({ id: t.id, value: t.tagName }))}
      />

      <FirmStringListCard
        firmId={firm.id}
        kind="companies"
        bodyKey="callrailCompanyId"
        title="CallRail companies"
        description="The fallback when no routing tag matched. A CallRail company maps to at most one firm, enforced by the database — a company mapped twice would have no correct answer."
        addLabel="Add a CallRail company id"
        placeholder="COM…"
        emptyHint="No company mappings. Leads from this firm's CallRail company will reach the admin queue unless a routing tag matches."
        initial={companies.map((c) => ({ id: c.id, value: c.callrailCompanyId }))}
      />

      <FirmUsersCard
        users={users.map((u) => ({
          id: u.id,
          email: u.email,
          isActive: u.isActive,
        }))}
      />

      <FirmDangerZoneCard
        firmId={firm.id}
        firmName={firm.name}
        leadCount={leadCount}
      />
    </div>
  );
}
