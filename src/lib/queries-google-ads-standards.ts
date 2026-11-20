import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db/client";
import { ppcAdStandards } from "./db/schema";
import type { Expected, MatchRule, Standard } from "./ads-standards";

const Expected = z.record(z.union([z.string(), z.boolean()]));

// Request shape for creating/updating a standard; shared by both API routes.
export const StandardBody = z.object({
  name: z.string().min(1, "name is required"),
  enabled: z.boolean(),
  match: z.object({ channelType: z.string().optional(), nameContains: z.string().optional() }).strict(),
  campaignExpected: Expected,
  adGroupExpected: Expected,
});

type Row = typeof ppcAdStandards.$inferSelect;

function toStandard(r: Row): Standard {
  return {
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    match: (r.match ?? {}) as MatchRule,
    campaignExpected: (r.campaignExpected ?? {}) as Expected,
    adGroupExpected: (r.adGroupExpected ?? {}) as Expected,
  };
}

export type StandardInput = {
  name: string;
  enabled: boolean;
  match: MatchRule;
  campaignExpected: Expected;
  adGroupExpected: Expected;
};

export async function getStandards(): Promise<Standard[]> {
  const rows = await db.select().from(ppcAdStandards).orderBy(asc(ppcAdStandards.createdAt));
  return rows.map(toStandard);
}

export async function createStandard(input: StandardInput): Promise<Standard> {
  const [row] = await db.insert(ppcAdStandards).values(input).returning();
  return toStandard(row);
}

export async function updateStandard(id: string, input: StandardInput): Promise<Standard | null> {
  const [row] = await db
    .update(ppcAdStandards)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(ppcAdStandards.id, id))
    .returning();
  return row ? toStandard(row) : null;
}

export async function deleteStandard(id: string): Promise<void> {
  await db.delete(ppcAdStandards).where(eq(ppcAdStandards.id, id));
}
