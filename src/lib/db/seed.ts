import { db } from "./client";
import { clients, gridConfigs, keywords, locations } from "./schema";

async function main() {
  const [client] = await db
    .insert(clients)
    .values({ name: "Test Client", slug: "test-client", status: "active" })
    .returning();

  const [location] = await db
    .insert(locations)
    .values({
      clientId: client.id,
      name: "Test Location - Atlanta",
      address: "123 Peachtree St NE, Atlanta, GA 30303",
      placeId: "ChIJAQAAAAAAAAARAAAAAAAAAAA",
      lat: "33.7589",
      lng: "-84.3880",
      pollFrequency: "daily",
      status: "active",
    })
    .returning();

  await db.insert(keywords).values([
    { locationId: location.id, keyword: "personal injury lawyer", isPrimary: true },
    { locationId: location.id, keyword: "car accident attorney", isPrimary: false },
  ]);

  await db.insert(gridConfigs).values({
    locationId: location.id,
    name: "5 mile, 7x7",
    size: 7,
    radiusMiles: "5",
    isDefault: true,
  });

  console.log("Seeded:", { clientId: client.id, locationId: location.id });
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
