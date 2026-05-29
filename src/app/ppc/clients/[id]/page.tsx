import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { Banner } from "@/components/ui/banner";
import { PpcClientAdminCard } from "@/components/ppc-client-admin-card";
import { db } from "@/lib/db/client";
import { ppcClients } from "@/lib/db/schema";
import { listCompanies } from "@/lib/callrail";
import { listExistingAdsCredentials } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const row = await db.query.ppcClients.findFirst({
    where: eq(ppcClients.id, id),
  });
  return { title: row?.name ?? "PPC client" };
}

export default async function PpcClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ads_link?: string; reason?: string }>;
}) {
  const [{ id }, { ads_link, reason }] = await Promise.all([
    params,
    searchParams,
  ]);
  const row = await db.query.ppcClients.findFirst({
    where: eq(ppcClients.id, id),
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

  // Surface existing google_ads credentials so the admin card can offer
  // one-click reuse rather than forcing a fresh OAuth round every time a
  // PPC client is added.
  const existingAdsCredentials = await listExistingAdsCredentials();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/ppc/clients"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          &larr; PPC clients
        </Link>
      </div>

      {ads_link === "linked" && (
        <Banner tone="success" title="Google Ads connected">
          We bound this client to the Google Ads customer id automatically.
          Click <strong>Sync now</strong> below to backfill the trailing 30
          days of campaign data.
        </Banner>
      )}
      {ads_link === "needs_picker" && (
        <Banner
          tone="warning"
          title="Connected — choose a Google Ads account"
        >
          Your Google account manages multiple Google Ads customer ids. Enter
          the right one in the Google Ads section below, then hit{" "}
          <strong>Sync now</strong>.
        </Banner>
      )}
      {ads_link === "no_customers" && (
        <Banner
          tone="warning"
          title="Connected — but no Google Ads accounts visible"
        >
          The Google account you authorized doesn&apos;t have access to any
          Google Ads customers. Sign in with the agency account that manages
          this client&apos;s ads and reconnect.
        </Banner>
      )}
      {ads_link === "list_failed" && (
        <Banner
          tone="warning"
          title="Connected, but we couldn't list Google Ads accounts"
        >
          Your token is saved &mdash; no need to reconnect. The discovery call
          failed with: <code>{reason ?? "unknown error"}</code>. Common causes:
          the developer token isn&apos;t approved yet (Google Ads &rarr; API
          Center), the OAuth client doesn&apos;t carry the{" "}
          <code>adwords</code> scope, or the connected Google account has no
          Ads access. You can also paste the customer id manually below.
        </Banner>
      )}
      {ads_link === "failed" && (
        <Banner tone="error" title="Google Ads connection failed">
          The OAuth handoff didn&apos;t complete. Try connecting again from
          the Google Ads section below.
        </Banner>
      )}

      <PpcClientAdminCard
        id={row.id}
        name={row.name}
        slug={row.slug}
        isActive={row.isActive}
        googleAdsTokenSaved={row.googleAdsOauthTokenId !== null}
        googleAdsLinked={
          row.googleAdsOauthTokenId !== null && row.googleAdsCustomerId !== null
        }
        googleAdsCustomerId={row.googleAdsCustomerId}
        callrailLinked={row.callrailCompanyId !== null}
        callrailCompanyId={row.callrailCompanyId}
        signedCaseTag={row.signedCaseTag}
        lastAdsSyncAt={row.lastAdsSyncAt}
        lastCallrailSyncAt={row.lastCallrailSyncAt}
        lastSyncError={row.lastSyncError}
        callrailCompanyChoices={callrailCompanyChoices}
        callrailListError={callrailListError}
        existingAdsCredentials={existingAdsCredentials}
      />
    </div>
  );
}
