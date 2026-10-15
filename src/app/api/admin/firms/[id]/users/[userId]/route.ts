import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { leadFirmUsers } from "@/lib/db/schema";
import { requireAdminRoute } from "@/lib/leads/admin-auth";
import {
  deactivateClientUser,
  reactivateClientUser,
  resetClientPassword,
  serviceRoleAuth,
  type ProvisionDeps,
} from "@/lib/portal/provision";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ActionBody = z
  .object({ action: z.enum(["deactivate", "reactivate", "reset_password"]) })
  .strict();
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

function deps(): ProvisionDeps {
  return {
    async getFirm() {
      throw new Error("not used by this route");
    },
    async insertMembership() {
      throw new Error("not used by this route");
    },
    // Scoped by BOTH the membership id and the firm in the URL, so a stale
    // tab cannot act on another firm's user by id alone.
    async getMembership(firmId, membershipId) {
      const row = await db.query.leadFirmUsers.findFirst({
        where: and(eq(leadFirmUsers.id, membershipId), eq(leadFirmUsers.firmId, firmId)),
      });
      return row
        ? { id: row.id, firmId: row.firmId, authUserId: row.authUserId, email: row.email, isActive: row.isActive }
        : null;
    },
    async setMembershipActive(membershipId, isActive) {
      await db
        .update(leadFirmUsers)
        .set({ isActive, updatedAt: new Date() })
        .where(eq(leadFirmUsers.id, membershipId));
    },
    auth: serviceRoleAuth(),
  };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const denied = await requireAdminRoute();
  if (denied) return denied;

  const { id, userId } = await params;
  if (!UUID.test(id) || !UUID.test(userId)) {
    return NextResponse.json({ error: "User not found for this firm." }, { status: 404, headers: NO_STORE });
  }

  let parsed;
  try {
    parsed = ActionBody.parse(await req.json());
  } catch {
    return NextResponse.json(
      { error: "Send an action: deactivate, reactivate or reset_password." },
      { status: 400, headers: NO_STORE },
    );
  }

  const d = deps();
  const result =
    parsed.action === "deactivate"
      ? await deactivateClientUser(d, id, userId)
      : parsed.action === "reactivate"
        ? await reactivateClientUser(d, id, userId)
        : await resetClientPassword(d, id, userId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status, headers: NO_STORE });
  }
  return NextResponse.json(
    result.temporaryPassword ? { ok: true, temporaryPassword: result.temporaryPassword } : { ok: true },
    { headers: NO_STORE },
  );
}
