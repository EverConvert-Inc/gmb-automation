// "Approve for client" — the write behind the drawer's button and the queue's
// bulk approve. Staff-only (the route checks). See clientVisibility in
// src/lib/portal/visibility.ts for what an approval does.

import { and, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { db } from "@/lib/db/client";
import { leads } from "@/lib/db/schema";
import { negativeTagsSql } from "@/lib/portal/visibility";

/** One lead from the drawer, or several from the queue's bulk approve. */
export const MAX_APPROVE = 500;
export const ApproveBody = z.object({ leadIds: z.array(z.string().uuid()).min(1).max(MAX_APPROVE) });

/**
 * Records who approved, when, and the negative tags each lead carries right
 * now — computed by the portal's own SQL — so the approval covers exactly
 * those: a negative tag that arrives later sends the lead back to review.
 * Only leads assigned to a firm; no other column changes.
 */
export function buildApproveUpdate(database: Pick<typeof db, "update">, leadIds: string[], approvedBy: string | null) {
  return database
    .update(leads)
    .set({
      clientApprovedAt: sql`now()`,
      clientApprovedBy: approvedBy,
      clientApprovedNegativeTags: sql.raw(negativeTagsSql('"leads"')),
      updatedAt: sql`now()`,
    })
    .where(and(inArray(leads.id, leadIds), isNotNull(leads.firmId)))
    .returning({ id: leads.id });
}
