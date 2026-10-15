import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { leadFirmUsers, leadFirms } from "@/lib/db/schema";
import { requireAdminRoute } from "@/lib/leads/admin-auth";
import {
  createClientUser,
  serviceRoleAuth,
  type ProvisionDeps,
} from "@/lib/portal/provision";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only an email. .strict() rejects any other key — a "role", an
// "app_metadata", anything — and the role is hard-coded in provision.ts in
// any case, never read from the request.
const CreateBody = z.object({ email: z.string() }).strict();

// The temporary password is in this response exactly once; nothing may keep it.
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

function deps(): ProvisionDeps {
  return {
    async getFirm(firmId) {
      const row = await db.query.leadFirms.findFirst({ where: eq(leadFirms.id, firmId) });
      return row ? { id: row.id, isActive: row.isActive } : null;
    },
    async insertMembership({ firmId, authUserId, email }) {
      const [row] = await db
        .insert(leadFirmUsers)
        .values({ firmId, authUserId, email })
        .returning();
      return {
        id: row.id,
        firmId: row.firmId,
        authUserId: row.authUserId,
        email: row.email,
        isActive: row.isActive,
      };
    },
    async getMembership() {
      throw new Error("not used by this route");
    },
    async setMembershipActive() {
      throw new Error("not used by this route");
    },
    auth: serviceRoleAuth(),
  };
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Staff only, failing closed, with the same 10s bound as every admin route.
  const denied = await requireAdminRoute();
  if (denied) return denied;

  const { id } = await params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "Firm not found." }, { status: 404, headers: NO_STORE });
  }

  let parsed;
  try {
    parsed = CreateBody.parse(await req.json());
  } catch {
    return NextResponse.json(
      { error: "Send only an email address." },
      { status: 400, headers: NO_STORE },
    );
  }

  const result = await createClientUser(deps(), { firmId: id, email: parsed.email });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status, headers: NO_STORE });
  }
  return NextResponse.json(
    { user: result.user, temporaryPassword: result.temporaryPassword },
    { status: 201, headers: NO_STORE },
  );
}
