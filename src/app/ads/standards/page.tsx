import type { Metadata } from "next";
import { getStandards } from "@/lib/queries-google-ads-standards";
import { GoogleAdsStandardsManager } from "@/components/google-ads-standards-manager";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Google Ads — Standards" };

export default async function GoogleAdsStandardsPage() {
  const standards = await getStandards();

  return (
    <div className="space-y-6">
      <header>
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Google Ads</div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Standards</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Define which campaigns a standard applies to and the settings it enforces. The Audit scores each campaign against
          its matching standard.
        </p>
      </header>

      <GoogleAdsStandardsManager standards={standards} />
    </div>
  );
}
