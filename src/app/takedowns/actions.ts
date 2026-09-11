"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { reviewTakedownAlerts } from "@/lib/db/schema";

export type TakedownStatus = "confirmed" | "filed" | "resolved";

export type UpdateTakedownStatusResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateTakedownStatus(
  id: string,
  status: TakedownStatus,
): Promise<UpdateTakedownStatusResult> {
  const existing = await db.query.reviewTakedownAlerts.findFirst({
    where: eq(reviewTakedownAlerts.id, id),
    columns: { id: true },
  });
  if (!existing) {
    return { ok: false, error: "Takedown alert not found" };
  }

  await db
    .update(reviewTakedownAlerts)
    .set({ status, updatedAt: new Date() })
    .where(eq(reviewTakedownAlerts.id, id));

  revalidatePath("/takedowns");
  return { ok: true };
}
