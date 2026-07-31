// Upserts one Facebook Lead Ads client (by page_id) with an encrypted page
// access token. Run once per client via:
//
//   npx tsx src/lib/seed-fb-lead-client.ts \
//     --name "Acme Dental" --slug acme-dental \
//     --page-id 123456789012345 --token "EAAG..."
//
// Re-running with the same --page-id updates the name/slug/token in place
// (upsert on the page_id unique constraint) instead of erroring.

import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { db } from "./db/client";
import { fbLeadClients } from "./db/schema";
import { encryptString } from "./crypto";

async function main() {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      slug: { type: "string" },
      "page-id": { type: "string" },
      token: { type: "string" },
    },
  });

  const { name, slug, token } = values;
  const pageId = values["page-id"];
  if (!name || !slug || !pageId || !token) {
    console.error(
      "Usage: tsx src/lib/seed-fb-lead-client.ts --name <name> --slug <slug> --page-id <id> --token <page access token>",
    );
    process.exit(1);
  }

  const pageAccessTokenEncrypted = encryptString(token);

  const existing = await db.query.fbLeadClients.findFirst({
    where: eq(fbLeadClients.pageId, pageId),
  });

  if (existing) {
    await db
      .update(fbLeadClients)
      .set({ name, slug, pageAccessTokenEncrypted, updatedAt: new Date() })
      .where(eq(fbLeadClients.id, existing.id));
    console.log(`Updated fb_lead_clients row for page_id=${pageId} (id=${existing.id})`);
  } else {
    const [row] = await db
      .insert(fbLeadClients)
      .values({ name, slug, pageId, pageAccessTokenEncrypted })
      .returning({ id: fbLeadClients.id });
    console.log(`Created fb_lead_clients row for page_id=${pageId} (id=${row.id})`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
