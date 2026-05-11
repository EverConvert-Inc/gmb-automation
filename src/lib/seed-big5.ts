// Idempotent seed for tracked SERP keywords. Run via `npm run seed:big5`.
// - Creates clients by slug if missing (uses the `name` and `slug` below).
// - Skips keyword triples (clientId, keyword, geoCity) that already exist.
// - If you have an existing client with a different slug, edit `slug` below
//   to match — otherwise this will create a duplicate client.

import { and, eq, isNull } from "drizzle-orm";
import { db } from "./db/client";
import { clients, trackedKeywords } from "./db/schema";
import { METRO_LOCATIONS } from "./dataforseo";

type SeedKeyword = { keyword: string; url: string; city: string | null };
type SeedClient = { name: string; slug: string; keywords: SeedKeyword[] };

const SEED: SeedClient[] = [
  {
    name: "Humberto",
    slug: "humberto",
    keywords: [
      { keyword: "Atlanta Workers' Compensation Lawyer", url: "https://www.humbertoinjurylaw.com/atlanta/workers-compensation-lawyer/", city: "Atlanta" },
      { keyword: "Cumming Workers' Compensation Lawyer", url: "https://www.humbertoinjurylaw.com/cumming/workers-compensation/", city: "Cumming" },
      { keyword: "Marietta Workers' Compensation Lawyer", url: "https://www.humbertoinjurylaw.com/marietta/workers-compensation-lawyer/", city: "Marietta" },
      { keyword: "Norcross Workers' Compensation Lawyer", url: "https://www.humbertoinjurylaw.com/norcross/workers-compensation-lawyer/", city: "Norcross" },
      { keyword: "Alpharetta Workers' Compensation Lawyer", url: "https://www.humbertoinjurylaw.com/alpharetta/workers-compensation-lawyer/", city: "Alpharetta" },
    ],
  },
  {
    name: "The Weinstein Firm",
    slug: "the-weinstein-firm",
    keywords: [
      { keyword: "Atlanta Car Accident Lawyer", url: "https://weinsteinwin.com/atlanta/car-accident-lawyer/", city: "Atlanta" },
      { keyword: "Atlanta Pedestrian Accident Lawyer", url: "https://weinsteinwin.com/atlanta/pedestrian-accident-lawyer/", city: "Atlanta" },
      { keyword: "Atlanta Motorcycle Accident Lawyer", url: "https://weinsteinwin.com/atlanta/motorcycle-accident-lawyer/", city: "Atlanta" },
      { keyword: "Atlanta Truck Accident Lawyer", url: "https://weinsteinwin.com/atlanta/truck-accident-lawyer/", city: "Atlanta" },
      { keyword: "Atlanta Uber Accident Lawyer", url: "https://weinsteinwin.com/atlanta/uber-accident-lawyer/", city: "Atlanta" },
    ],
  },
  {
    name: "GIC",
    slug: "gic",
    keywords: [
      { keyword: "Atlanta Car Accident Chiropractor", url: "https://1800hurt911ga.com/atlanta/car-accident-chiropractor/", city: "Atlanta" },
      { keyword: "Atlanta Car Accident Doctor", url: "https://1800hurt911ga.com/atlanta/car-accident-doctor/", city: "Atlanta" },
      { keyword: "Whiplash Injury Treatment in Atlanta", url: "https://1800hurt911ga.com/atlanta/whiplash-injury-treatment/", city: "Atlanta" },
      { keyword: "Atlanta Personal Injury Doctor", url: "https://1800hurt911ga.com/atlanta/personal-injury-doctor/", city: "Atlanta" },
      { keyword: "Lawrenceville Car Accident Chiropractor", url: "https://1800hurt911ga.com/lawrenceville/car-accident-chiropractor/", city: "Lawrenceville" },
    ],
  },
  {
    name: "AAL",
    slug: "aal",
    keywords: [
      { keyword: "Atlanta Rideshare Accident Lawyer", url: "https://atlanta-accidentlawyers.com/atlanta/rideshare-accident-lawyer/", city: "Atlanta" },
      { keyword: "Lawrenceville Motorcycle Accident Lawyer", url: "https://atlanta-accidentlawyers.com/lawrenceville/motorcycle-accident-lawyer/", city: "Lawrenceville" },
      { keyword: "Atlanta Pedestrian Accident Lawyer", url: "https://atlanta-accidentlawyers.com/atlanta/pedestrian-accident-lawyer/", city: "Atlanta" },
      { keyword: "Decatur Pedestrian Accident Lawyer", url: "https://atlanta-accidentlawyers.com/decatur/pedestrian-accident-lawyer/", city: "Decatur" },
      { keyword: "Atlanta Car Accident Lawyer", url: "https://atlanta-accidentlawyers.com/atlanta/car-accident-lawyer/", city: "Atlanta" },
    ],
  },
  {
    name: "ATL Metro",
    slug: "atl-metro",
    keywords: [
      { keyword: "Atlanta Motorcycle Accident Lawyer", url: "https://atlantametrolaw.com/atlanta/motorcycle-accident-lawyer/", city: "Atlanta" },
      { keyword: "Atlanta Pedestrian Accident Lawyer", url: "https://atlantametrolaw.com/atlanta/pedestrian-accident-lawyer/", city: "Atlanta" },
      { keyword: "Atlanta Distracted Driving Accident Lawyer", url: "https://atlantametrolaw.com/atlanta/car-accident-lawyer/distracted-driving/", city: "Atlanta" },
      { keyword: "Atlanta Drunk Driving Accident Lawyer", url: "https://atlantametrolaw.com/atlanta/car-accident-lawyer/drunk-driving/", city: "Atlanta" },
      { keyword: "Atlanta Bicycle Accident Lawyer", url: "https://atlantametrolaw.com/atlanta/bicycle-accident-lawyer/", city: "Atlanta" },
    ],
  },
  {
    name: "WIR",
    slug: "wir",
    keywords: [
      { keyword: "Miami Workers' Compensation Lawyer", url: "https://workinjuryrights.com/miami/workers-compensation-lawyer/", city: "Miami" },
      { keyword: "Coral Gables Workers' Compensation Lawyer", url: "https://workinjuryrights.com/coral-gables/workers-compensation-lawyer/", city: "Coral Gables" },
      { keyword: "Miami Construction Accident Lawyer", url: "https://workinjuryrights.com/miami/workers-compensation-lawyer/construction-accident-lawyer/", city: "Miami" },
      { keyword: "Miami Work Injury Lawyer", url: "https://workinjuryrights.com/miami/", city: "Miami" },
      { keyword: "Abogado de Compensación Laboral de Miami", url: "https://workinjuryrights.com/es/miami/abogado-compensacion-laboral/", city: "Miami" },
    ],
  },
  {
    name: "McDougall",
    slug: "mcdougall",
    keywords: [
      { keyword: "Beaufort Personal Injury Lawyer", url: "https://mcdougalllawfirm.com/beaufort/personal-injury-lawyer/", city: "Beaufort" },
      { keyword: "Beaufort Car Accident Lawyer", url: "https://mcdougalllawfirm.com/beaufort/car-accident-lawyer/", city: "Beaufort" },
      { keyword: "Charleston Car Accident Lawyer", url: "https://mcdougalllawfirm.com/charleston/car-accident-lawyer/", city: "Charleston" },
      { keyword: "Bluffton Car Accident Lawyer", url: "https://mcdougalllawfirm.com/bluffton/car-accident-lawyer/", city: "Bluffton" },
      { keyword: "Beaufort Truck Accident Lawyer", url: "https://mcdougalllawfirm.com/beaufort/truck-accident-lawyer/", city: "Beaufort" },
    ],
  },
  {
    name: "Recovery Carolina",
    slug: "recovery-carolina",
    keywords: [
      { keyword: "Fayetteville Drug Rehab", url: "https://recoverycentercarolinas.com/fayetteville/drug-rehab/", city: "Fayetteville" },
      { keyword: "Durham Alcohol Recovery Program", url: "https://recoverycentercarolinas.com/durham/alcohol-recovery-program/", city: "Durham" },
      { keyword: "Drug Rehab", url: "https://recoverycentercarolinas.com/drug-rehab/", city: null },
      { keyword: "Addiction Treatment Center", url: "https://recoverycentercarolinas.com/addiction-treatment/", city: null },
      { keyword: "Dual Diagnosis Treatment Center", url: "https://recoverycentercarolinas.com/dual-diagnosis-treatment-center/", city: null },
    ],
  },
  {
    name: "WCL ATL",
    slug: "wcl-atl",
    keywords: [
      { keyword: "Atlanta Workers' Compensation Lawyer", url: "https://workerscompensationlawyersatlanta.com/atlanta/workers-compensation-lawyer/", city: "Atlanta" },
      { keyword: "Atlanta Construction Accident Lawyer", url: "https://workerscompensationlawyersatlanta.com/atlanta/construction-accident-lawyer/", city: "Atlanta" },
      { keyword: "Alpharetta Workers' Compensation Lawyer", url: "https://workerscompensationlawyersatlanta.com/alpharetta/workers-compensation-lawyer/", city: "Alpharetta" },
      { keyword: "Kennesaw Workers' Compensation Lawyer", url: "https://workerscompensationlawyersatlanta.com/kennesaw/workers-compensation-lawyer/", city: "Kennesaw" },
      { keyword: "El Abogado de Compensación de los Trabajadores en Atlanta", url: "https://workerscompensationlawyersatlanta.com/es/atlanta/abogado-de-compensacion-de-los-trabajadores/", city: "Atlanta" },
    ],
  },
];

async function ensureClient(name: string, slug: string): Promise<string> {
  const existing = await db.query.clients.findFirst({
    where: eq(clients.slug, slug),
  });
  if (existing) {
    return existing.id;
  }
  const [created] = await db
    .insert(clients)
    .values({ name, slug })
    .returning({ id: clients.id });
  console.log(`  + created client '${slug}' (${name})`);
  return created.id;
}

async function seedBig5(): Promise<void> {
  console.log("Seeding tracked SERP keywords...");
  let inserted = 0;
  let skipped = 0;
  let createdClients = 0;
  let missingCities = 0;

  for (const cli of SEED) {
    const before = await db.query.clients.findFirst({
      where: eq(clients.slug, cli.slug),
    });
    const clientId = await ensureClient(cli.name, cli.slug);
    if (!before) createdClients++;

    for (const kw of cli.keywords) {
      const geoCity = kw.city;

      const existing = await db.query.trackedKeywords.findFirst({
        where: and(
          eq(trackedKeywords.clientId, clientId),
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
        missingCities++;
      }

      await db.insert(trackedKeywords).values({
        clientId,
        keyword: kw.keyword,
        targetUrl: kw.url,
        geoCity: geoLocationCode ? geoCity : null,
        geoLocationCode: geoLocationCode ?? null,
      });
      console.log(`  ✓ ${cli.slug} / "${kw.keyword}" (${geoCity ?? "national"})`);
      inserted++;
    }
  }

  console.log("");
  console.log(
    `Done. Created ${createdClients} client(s), inserted ${inserted} keyword(s), skipped ${skipped}, ${missingCities} city lookups missed.`,
  );
}

seedBig5()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
