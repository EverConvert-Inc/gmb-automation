import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, eq, sql } from "drizzle-orm";
import { LsaClientAdminCard } from "@/components/lsa-client-admin-card";
import { db } from "@/lib/db/client";
import { lsaClients } from "@/lib/db/schema";
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
        lastAdsSyncAt={row.lastAdsSyncAt}
        lastCallrailSyncAt={row.lastCallrailSyncAt}
        lastSyncError={row.lastSyncError}
        callrailCompanyChoices={callrailCompanyChoices}
        callrailListError={callrailListError}
        existingAdsCredentials={existingAdsCredentials}
        linkedAdsCustomerMap={linkedAdsCustomerMap}
        linkedCallrailCompanyMap={linkedCallrailCompanyMap}
      />
    </div>
  );
}
