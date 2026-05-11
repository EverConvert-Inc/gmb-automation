// Idempotent seed for the Big 5 SERP keywords. Run via `npm run seed:big5`.
// Looks up each client by slug; skips clients that don't exist; skips
// keyword triples (clientId, keyword, geoCity) that already exist.

import { and, eq, isNull } from "drizzle-orm";
import { db } from "./db/client";
import { clients, trackedKeywords } from "./db/schema";
import { METRO_LOCATIONS } from "./dataforseo";

type SeedKeyword = { keyword: string; url: string; city: string | null };
type SeedClient = { slug: string; keywords: SeedKeyword[] };

const BIG_5_SEED: SeedClient[] = [
  {
    slug: "humberto",
    keywords: [
      {
        keyword: "Atlanta Workers' Compensation Lawyer",
        url: "https://www.humbertoinjurylaw.com/atlanta/workers-compensation-lawyer/",
        city: "Atlanta",
      },
      {
        keyword: "Cumming Workers' Compensation Lawyer",
        url: "https://www.humbertoinjurylaw.com/cumming/workers-compensation/",
        city: "Cumming",
      },
      {
        keyword: "Marietta Workers' Compensation Lawyer",
        url: "https://www.humbertoinjurylaw.com/marietta/workers-compensation-lawyer/",
        city: "Marietta",
      },
      {
        keyword: "Norcross Workers' Compensation Lawyer",
        url: "https://www.humbertoinjurylaw.com/norcross/workers-compensation-lawyer/",
        city: "Norcross",
      },
      {
        keyword: "Alpharetta Workers' Compensation Lawyer",
        url: "https://www.humbertoinjurylaw.com/alpharetta/workers-compensation-lawyer/",
        city: "Alpharetta",
      },
    ],
  },
  {
    slug: "the-weinstein-firm",
    keywords: [
      {
        keyword: "Atlanta Car Accident Lawyer",
        url: "https://weinsteinwin.com/atlanta/car-accident-lawyer/",
        city: "Atlanta",
      },
      {
        keyword: "Atlanta Pedestrian Accident Lawyer",
        url: "https://weinsteinwin.com/atlanta/pedestrian-accident-lawyer/",
        city: "Atlanta",
      },
      {
        keyword: "Atlanta Motorcycle Accident Lawyer",
        url: "https://weinsteinwin.com/atlanta/motorcycle-accident-lawyer/",
        city: "Atlanta",
      },
      {
        keyword: "Atlanta Truck Accident Lawyer",
        url: "https://weinsteinwin.com/atlanta/truck-accident-lawyer/",
        city: "Atlanta",
      },
      {
        keyword: "Atlanta Uber Accident Lawyer",
        url: "https://weinsteinwin.com/atlanta/uber-accident-lawyer/",
        city: "Atlanta",
      },
    ],
  },
];

async function seedBig5(): Promise<void> {
  console.log("Seeding Big 5 SERP keywords...");
  let inserted = 0;
  let skipped = 0;
  let missing = 0;

  for (const cli of BIG_5_SEED) {
    const client = await db.query.clients.findFirst({
      where: eq(clients.slug, cli.slug),
    });
    if (!client) {
      console.warn(`  ⚠ client '${cli.slug}' not found in DB, skipping`);
      missing++;
      continue;
    }

    for (const kw of cli.keywords) {
      const geoCity = kw.city;
      const existing = await db.query.trackedKeywords.findFirst({
        where: and(
          eq(trackedKeywords.clientId, client.id),
          eq(trackedKeywords.keyword, kw.keyword),
          geoCity
            ? eq(trackedKeywords.geoCity, geoCity)
            : isNull(trackedKeywords.geoCity),
        ),
      });
      if (existing) {
        console.log(`  · ${cli.slug} / "${kw.keyword}" (${geoCity ?? "national"}) already exists`);
        skipped++;
        continue;
      }
      const geoLocationCode = geoCity ? METRO_LOCATIONS[geoCity] : null;
      if (geoCity && !geoLocationCode) {
        console.warn(`  ⚠ city '${geoCity}' missing from METRO_LOCATIONS; inserting as national-only`);
      }
      await db.insert(trackedKeywords).values({
        clientId: client.id,
        keyword: kw.keyword,
        targetUrl: kw.url,
        geoCity: geoLocationCode ? geoCity : null,
        geoLocationCode: geoLocationCode ?? null,
      });
      console.log(`  ✓ ${cli.slug} / "${kw.keyword}" (${geoCity ?? "national"})`);
      inserted++;
    }
  }

  console.log(
    `Done. Inserted ${inserted}, skipped ${skipped}, missing-client ${missing}.`,
  );
}

seedBig5()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
