import { NextResponse } from "next/server";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { leadFirmCallrailCompanies, leadFirms } from "@/lib/db/schema";
import {
  PG_UNIQUE_VIOLATION,
  normalizeCompanyId,
  pgErrorCode,
} from "@/lib/leads/firm-admin";

export const runtime = "nodejs";

const CreateBody = z.object({ callrailCompanyId: z.string().min(1) }).strict();

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const rows = await db.query.leadFirmCallrailCompanies.findMany({
    where: eq(leadFirmCallrailCompanies.firmId, id),
    orderBy: asc(leadFirmCallrailCompanies.callrailCompanyId),
  });
  return NextResponse.json({ companies: rows });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let parsed;
  try {
    parsed = CreateBody.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  const firm = await db.query.leadFirms.findFirst({ where: eq(leadFirms.id, id) });
  if (!firm) return NextResponse.json({ error: "not found" }, { status: 404 });

  const callrailCompanyId = normalizeCompanyId(parsed.callrailCompanyId);
  if (!callrailCompanyId) {
    return NextResponse.json({ error: "Company id is empty." }, { status: 400 });
  }

  try {
    const [row] = await db
      .insert(leadFirmCallrailCompanies)
      .values({ firmId: id, callrailCompanyId })
      .returning();
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    // callrail_company_id is GLOBALLY unique, unlike the nullable,
    // non-unique column on ppc_clients/lsa_clients. Routing rule 2 is
    // singular, so a company mapped to two firms has no correct answer —
    // the constraint makes that state unrepresentable rather than letting
    // the sync guess, which would hand one firm's leads to another.
    if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
      const existing = await db.query.leadFirmCallrailCompanies.findFirst({
        where: eq(leadFirmCallrailCompanies.callrailCompanyId, callrailCompanyId),
      });
      const owner = existing
        ? await db.query.leadFirms.findFirst({ where: eq(leadFirms.id, existing.firmId) })
        : null;
      return NextResponse.json(
        {
          error:
            owner && owner.id === id
              ? `This firm is already mapped to ${callrailCompanyId}.`
              : `${callrailCompanyId} is already mapped to ${owner?.name ?? "another firm"}. A CallRail company maps to at most one firm.`,
        },
        { status: 409 },
      );
    }
    throw err;
  }
}
