import type { Metadata } from "next";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { Card, CardContent } from "@/components/ui/card";
import { GoogleAdsAuditTable } from "@/components/google-ads-audit-table";
import { db } from "@/lib/db/client";
import { ppcClients } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Google Ads — Audit" };

export default async function GoogleAdsAuditPage() {
  const accounts = await db
    .select({ id: ppcClients.id, name: ppcClients.name })
    .from(ppcClients)
    .where(and(eq(ppcClients.isActive, true), isNotNull(ppcClients.googleAdsCustomerId)))
    .orderBy(asc(ppcClients.name));

  return (
    <div className="space-y-6">
      <header>
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Google Ads</div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Audit</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Campaign settings pulled live and scored against your standards. Expand an account to see each campaign&apos;s
          compliance and configuration.
        </p>
      </header>

      <Card>
        <CardContent className="p-0">
          <GoogleAdsAuditTable accounts={accounts} />
        </CardContent>
      </Card>
    </div>
  );
}
