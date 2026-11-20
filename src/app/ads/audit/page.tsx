import type { Metadata } from "next";
import { GoogleAdsWorkspaceStub } from "@/components/google-ads-workspace-stub";

export const metadata: Metadata = { title: "Google Ads — Audit" };

export default function GoogleAdsAuditPage() {
  return (
    <GoogleAdsWorkspaceStub
      title="Audit"
      description="Campaign compliance against your standards — Passed / Errors / Needs review / Unmatched, with scheduled and manual runs and a drilldown to ad group and ad settings."
    />
  );
}
