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

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const row = await db.query.leadFirms.findFirst({ where: eq(leadFirms.id, id) });
  return { title: row?.name ?? "Firm" };
}

export default async function FirmDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const firm = await db.query.leadFirms.findFirst({ where: eq(leadFirms.id, id) });
  if (!firm) notFound();

  const [tags, companies, users, leadCountRow] = await Promise.all([
    db.query.leadFirmTags.findMany({
      where: eq(leadFirmTags.firmId, id),
      orderBy: asc(leadFirmTags.tagNameLower),
    }),
    db.query.leadFirmCallrailCompanies.findMany({
      where: eq(leadFirmCallrailCompanies.firmId, id),
      orderBy: asc(leadFirmCallrailCompanies.callrailCompanyId),
    }),
    db.query.leadFirmUsers.findMany({
      where: eq(leadFirmUsers.firmId, id),
      orderBy: asc(leadFirmUsers.email),
    }),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(leads)
      .where(eq(leads.firmId, id)),
  ]);
  const leadCount = leadCountRow[0]?.n ?? 0;

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
