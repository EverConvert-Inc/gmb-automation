import { NextResponse } from "next/server";
import { z } from "zod";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  leadFirmCallrailCompanies,
  leadFirmTags,
  leadFirmUsers,
  leadFirms,
  leads,
} from "@/lib/db/schema";
import { PG_UNIQUE_VIOLATION, pgErrorCode, slugify } from "@/lib/leads/firm-admin";
import { requireAdminRoute } from "@/lib/leads/admin-auth";

export const runtime = "nodejs";

const CreateBody = z
  .object({
    name: z.string().min(1),
    // Derived from the name when omitted, so the common path is one field.
    slug: z.string().min(1).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export type FirmSummary = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  tagCount: number;
  companyCount: number;
  userCount: number;
  leadCount: number;
};

async function countsBy(
  table: typeof leadFirmTags | typeof leadFirmCallrailCompanies | typeof leadFirmUsers,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ firmId: table.firmId, n: sql<number>`count(*)::int` })
    .from(table)
    .groupBy(table.firmId);
  return new Map(rows.map((r) => [r.firmId, r.n]));
}

export async function GET() {
  // Staff-only. Every internal route in this repo is middleware-only, which
  // cannot tell a staff member from a client user — see admin-auth.ts.
  const denied = await requireAdminRoute();
  if (denied) return denied;
  const [firms, tagCounts, companyCounts, userCounts, leadRows] = await Promise.all([
    db.query.leadFirms.findMany({ orderBy: asc(leadFirms.name) }),
    countsBy(leadFirmTags),
    countsBy(leadFirmCallrailCompanies),
    countsBy(leadFirmUsers),
    db
      .select({ firmId: leads.firmId, n: sql<number>`count(*)::int` })
      .from(leads)
      .groupBy(leads.firmId),
  ]);
  const leadCounts = new Map(
    leadRows.filter((r) => r.firmId !== null).map((r) => [r.firmId as string, r.n]),
  );

  const summaries: FirmSummary[] = firms.map((f) => ({
    id: f.id,
    name: f.name,
    slug: f.slug,
    isActive: f.isActive,
    tagCount: tagCounts.get(f.id) ?? 0,
    companyCount: companyCounts.get(f.id) ?? 0,
    userCount: userCounts.get(f.id) ?? 0,
    leadCount: leadCounts.get(f.id) ?? 0,
  }));

  // Leads with no firm at all — the admin queue's headline number.
  const unassigned = leadRows.find((r) => r.firmId === null)?.n ?? 0;

  return NextResponse.json({ firms: summaries, unassignedLeadCount: unassigned });
}

export async function POST(req: Request) {
  // Staff-only. Every internal route in this repo is middleware-only, which
  // cannot tell a staff member from a client user — see admin-auth.ts.
  const denied = await requireAdminRoute();
  if (denied) return denied;
  let parsed;
  try {
    parsed = CreateBody.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  const slug = slugify(parsed.slug ?? parsed.name);
  if (!slug) {
    return NextResponse.json(
      { error: "Could not derive a slug from that name. Enter one explicitly." },
      { status: 400 },
    );
  }

  try {
    const [row] = await db
      .insert(leadFirms)
      .values({ name: parsed.name.trim(), slug, isActive: parsed.isActive ?? true })
      .returning();
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    // The slug is UNIQUE. Two firms sharing a name is a decision for whoever
    // is typing, not something to silently disambiguate with a suffix.
    if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
      const existing = await db.query.leadFirms.findFirst({
        where: eq(leadFirms.slug, slug),
      });
      return NextResponse.json(
        {
          error: `The slug "${slug}" is already used by ${existing?.name ?? "another firm"}. Give this firm a different slug.`,
        },
        { status: 409 },
      );
    }
    throw err;
  }
}
