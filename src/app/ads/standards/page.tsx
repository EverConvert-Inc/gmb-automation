import type { Metadata } from "next";
import { GoogleAdsWorkspaceStub } from "@/components/google-ads-workspace-stub";

export const metadata: Metadata = { title: "Google Ads — Standards" };

export default function GoogleAdsStandardsPage() {
  return (
    <GoogleAdsWorkspaceStub
      title="Standards"
      description="Define which campaigns a standard applies to and the expected settings to enforce, at campaign and ad-group level — plus auto-grouped suggestions from unmatched campaigns."
    />
  );
}
