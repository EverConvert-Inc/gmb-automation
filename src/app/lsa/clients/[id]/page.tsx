import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { LsaClientAdminCard } from "@/components/lsa-client-admin-card";
import { LsaCallrailTagCategoriesCard } from "@/components/lsa-callrail-tag-categories-card";
import { db } from "@/lib/db/client";
import { callrailWebhookSecrets, lsaCallrailTagCategories, lsaClients } from "@/lib/db/schema";
import { listCompanies } from "@/lib/callrail";
import { listExistingAdsCredentials } from "@/lib/queries";
import {
  getLinkedLsaAdsCustomerMap,
  getLinkedLsaCallrailCompanyMap,
} from "@/lib/queries-lsa";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const row = await db.query.lsaClients.findFirst({
    where: eq(lsaClients.id, id),
  });
  return { title: row?.name ?? "LSA client" };
}

export default async function LsaClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let row = await db.query.lsaClients.findFirst({
    where: eq(lsaClients.id, id),
  });
  if (!row) notFound();

  // Best-effort CallRail company list — falls back to a free-text input if
  // the API key isn't set or the call fails.
  let callrailCompanyChoices: { id: string; name: string }[] | null = null;
  let callrailListError: string | null = null;
  try {
    const companies = await listCompanies();
    callrailCompanyChoices = companies.map((c) => ({ id: c.id, name: c.name }));
  } catch (e) {
    callrailListError = (e as Error).message;
  }

  // Reused verbatim from PPC's setup — listExistingAdsCredentials() is
  // generic across providers, not tied to ppc_clients.
  const existingAdsCredentials = await listExistingAdsCredentials();

  const [linkedAdsCustomerMap, linkedCallrailCompanyMap] = await Promise.all([
    getLinkedLsaAdsCustomerMap(id),
    getLinkedLsaCallrailCompanyMap(id),
  ]);

  // Webhook secret status only — never the decrypted secret itself. Keyed
  // by CallRail company id, not this client's id, since the secret can be
  // shared with a ppc_clients row on the same company (see
  // callrailWebhookSecrets in schema.ts).
  const webhookSecretRow = row.callrailCompanyId
    ? await db.query.callrailWebhookSecrets.findFirst({
        where: eq(callrailWebhookSecrets.callrailCompanyId, row.callrailCompanyId),
      })
    : null;

  // Auto-attach the most-recently-used Google Ads credential when an LSA
  // client is loaded with nothing connected yet, same rationale as PPC:
  // the standard path is "same agency account every time," so save the
  // operator a click. Also copies the discovered-customers cache from
  // another client using the same credential when available.
  if (!row.googleAdsOauthTokenId && existingAdsCredentials.length > 0) {
    const cred = existingAdsCredentials[0]; // ordered by updatedAt desc
    const cacheDonor = await db.query.lsaClients.findFirst({
      where: and(
        eq(lsaClients.googleAdsOauthTokenId, cred.id),
        sql`${lsaClients.googleAdsDiscoveredCustomersJson} is not null`,
      ),
    });
    await db
      .update(lsaClients)
      .set({
        googleAdsOauthTokenId: cred.id,
        ...(cacheDonor?.googleAdsDiscoveredCustomersJson
          ? {
              googleAdsDiscoveredCustomersJson:
                cacheDonor.googleAdsDiscoveredCustomersJson,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(lsaClients.id, row.id));
    const refreshed = await db.query.lsaClients.findFirst({
      where: eq(lsaClients.id, row.id),
    });
    if (refreshed) row = refreshed;
  }

  // Auto-fill login_customer_id from the most-recently-used value across
  // other LSA clients when this client doesn't have one yet. In practice
  // every LSA client currently shares the same MCC, so this saves
  // re-typing "663-311-7348" on every new client — same rationale as the
  // OAuth auto-attach above, just for a plain field instead of a
  // discovery-backed one. Still editable afterward; this only sets a
  // starting value, it doesn't lock anything.
  if (!row.loginCustomerId) {
    const donor = await db.query.lsaClients.findFirst({
      where: and(
        ne(lsaClients.id, row.id),
        sql`${lsaClients.loginCustomerId} is not null`,
      ),
      orderBy: (cols, ops) => ops.desc(cols.updatedAt),
    });
    if (donor?.loginCustomerId) {
      await db
        .update(lsaClients)
        .set({ loginCustomerId: donor.loginCustomerId, updatedAt: new Date() })
        .where(eq(lsaClients.id, row.id));
      const refreshed = await db.query.lsaClients.findFirst({
        where: eq(lsaClients.id, row.id),
      });
      if (refreshed) row = refreshed;
    }
  }

  // rollup is stored as plain text (no DB-level enum); narrowed here since
  // the API routes are the only writers and always validate it against
  // z.enum(["real", "junk"]) before insert/update.
  const tagCategories = (
    await db.query.lsaCallrailTagCategories.findMany({
      where: eq(lsaCallrailTagCategories.lsaClientId, id),
      orderBy: asc(lsaCallrailTagCategories.sortOrder),
    })
  ).map((c) => ({ ...c, rollup: c.rollup as "real" | "junk" }));

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/lsa/clients"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          &larr; LSA clients
        </Link>
      </div>

      <LsaClientAdminCard
        id={row.id}
        name={row.name}
        slug={row.slug}
        isActive={row.isActive}
        googleAdsTokenSaved={row.googleAdsOauthTokenId !== null}
        googleAdsLinked={
          row.googleAdsOauthTokenId !== null && row.googleAdsCustomerId !== null
        }
        googleAdsCustomerId={row.googleAdsCustomerId}
        googleAdsDiscoveredCustomers={
          (row.googleAdsDiscoveredCustomersJson as
            | Array<{ id: string; name: string | null }>
            | null) ?? null
        }
        loginCustomerId={row.loginCustomerId}
        callrailLinked={row.callrailCompanyId !== null}
        callrailCompanyId={row.callrailCompanyId}
        signedCaseTag={row.signedCaseTag}
        signedCaseNameFilters={row.signedCaseNameFilters}
        gmbCallrailNameFilters={row.gmbCallrailNameFilters}
        lastAdsSyncAt={row.lastAdsSyncAt}
        lastCallrailSyncAt={row.lastCallrailSyncAt}
        lastSyncError={row.lastSyncError}
        callrailCompanyChoices={callrailCompanyChoices}
        callrailListError={callrailListError}
        webhookSecretConfigured={!!webhookSecretRow}
        webhookSecretUpdatedAt={webhookSecretRow?.updatedAt.toISOString() ?? null}
        existingAdsCredentials={existingAdsCredentials}
        linkedAdsCustomerMap={linkedAdsCustomerMap}
        linkedCallrailCompanyMap={linkedCallrailCompanyMap}
      />

      <LsaCallrailTagCategoriesCard clientId={row.id} initial={tagCategories} />
    </div>
  );
}
