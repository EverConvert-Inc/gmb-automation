import type { Metadata } from "next";
import { GoogleAdsWorkspaceStub } from "@/components/google-ads-workspace-stub";

export const metadata: Metadata = { title: "Google Ads — Pacing" };

export default function GoogleAdsPacingPage() {
  return (
    <GoogleAdsWorkspaceStub
      title="Pacing"
      description="Monthly budget vs spend, pace %, projected month-end, daily need vs daily set, hot/cold status, and CSV export."
    />
  );
}
