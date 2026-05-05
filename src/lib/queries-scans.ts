import { desc, eq } from "drizzle-orm";
import { db } from "./db/client";
import { clients, locations, scans } from "./db/schema";

export async function listRecentScansAcrossClients(limit = 50) {
  return db
    .select({
      id: scans.id,
      status: scans.status,
      triggeredBy: scans.triggeredBy,
      startedAt: scans.startedAt,
      completedAt: scans.completedAt,
      totalPoints: scans.totalPoints,
      totalKeywords: scans.totalKeywords,
      costEstimate: scans.costEstimate,
      locationId: locations.id,
      locationName: locations.name,
      clientName: clients.name,
      clientSlug: clients.slug,
    })
    .from(scans)
    .innerJoin(locations, eq(scans.locationId, locations.id))
    .innerJoin(clients, eq(locations.clientId, clients.id))
    .orderBy(desc(scans.startedAt))
    .limit(limit);
}
