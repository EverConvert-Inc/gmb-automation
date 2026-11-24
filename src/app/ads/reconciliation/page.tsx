import type { Metadata } from "next";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { Card, CardContent } from "@/components/ui/card";
import { GoogleAdsReconciliationFilters } from "@/components/google-ads-reconciliation-filters";
import { GoogleAdsReconciliationTable } from "@/components/google-ads-reconciliation-table";
import { daysAgoIsoEastern, yesterdayIsoEastern } from "@/lib/date-utils";
import { db } from "@/lib/db/client";
import { ppcClients } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Google Ads — Reconciliation" };

export default async function GoogleAdsReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const sp = await searchParams;
  const days = sp.days === "30" ? 30 : sp.days === "14" ? 14 : 7;
  const to = yesterdayIsoEastern();
  const from = daysAgoIsoEastern(days);

  const accounts = await db
    .select({ id: ppcClients.id, name: ppcClients.name })
    .from(ppcClients)
    .where(and(eq(ppcClients.isActive, true), isNotNull(ppcClients.googleAdsCustomerId)))
    .orderBy(asc(ppcClients.name));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Google Ads</div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Reconciliation</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Checks each account&apos;s Google Ads conversion counts against the CallRail source they&apos;re mapped to, so
            drift between what Ads reports and what actually came through is visible. Expand an account to see its rows and
            set up mappings.
          </p>
        </div>
        <GoogleAdsReconciliationFilters days={days} />
      </header>

      <Card>
        <CardContent className="p-0">
          <GoogleAdsReconciliationTable accounts={accounts} from={from} to={to} />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Window: {from} → {to}. Google Ads conversions and CallRail form counts are pulled live; first-time calls and
        signed leads come from the synced CallRail data (PPC + PMax, GMB excluded).
      </p>
    </div>
  );
}
