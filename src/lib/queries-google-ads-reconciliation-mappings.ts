import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db/client";
import { ppcReconciliationMappings } from "./db/schema";
import { isReconSource, type ReconMapping, type ReconSource } from "./ads-reconciliation";

const SOURCE = z.enum([
  "callrail_first_time_calls",
  "callrail_good_leads",
  "callrail_form_submissions",
]);

const FIELDS = {
  label: z.string().min(1, "label is required"),
  adsConversionActionId: z.string().min(1, "a conversion action is required"),
  adsConversionActionName: z.string().default(""),
  source: SOURCE,
  enabled: z.boolean(),
};

// A mapping is created against a specific PPC client; the client never changes
// afterwards (you'd delete and re-create), so only the create body carries it.
export const ReconMappingCreateBody = z.object({
  ppcClientId: z.string().uuid(),
  ...FIELDS,
});
export const ReconMappingUpdateBody = z.object(FIELDS);

export type ReconMappingCreate = z.infer<typeof ReconMappingCreateBody>;
export type ReconMappingUpdate = z.infer<typeof ReconMappingUpdateBody>;

type Row = typeof ppcReconciliationMappings.$inferSelect;

function toMapping(r: Row): ReconMapping {
  return {
    id: r.id,
    label: r.label,
    adsConversionActionId: r.adsConversionActionId,
    adsConversionActionName: r.adsConversionActionName,
    // DB column is free text; fall back to the first-time-calls metric if a
    // row ever holds an unknown value rather than letting it leak out untyped.
    source: isReconSource(r.source) ? (r.source as ReconSource) : "callrail_first_time_calls",
    enabled: r.enabled,
  };
}

export async function getMappingsForClient(ppcClientId: string): Promise<ReconMapping[]> {
  const rows = await db
    .select()
    .from(ppcReconciliationMappings)
    .where(eq(ppcReconciliationMappings.ppcClientId, ppcClientId))
    .orderBy(asc(ppcReconciliationMappings.createdAt));
  return rows.map(toMapping);
}

export async function createMapping(input: ReconMappingCreate): Promise<ReconMapping> {
  const [row] = await db.insert(ppcReconciliationMappings).values(input).returning();
  return toMapping(row);
}

export async function updateMapping(
  id: string,
  input: ReconMappingUpdate,
): Promise<ReconMapping | null> {
  const [row] = await db
    .update(ppcReconciliationMappings)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(ppcReconciliationMappings.id, id))
    .returning();
  return row ? toMapping(row) : null;
}

export async function deleteMapping(id: string): Promise<void> {
  await db.delete(ppcReconciliationMappings).where(eq(ppcReconciliationMappings.id, id));
}
