import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SignOutButton } from "@/components/sign-out-button";
import { PpcReportRecipientsCard } from "@/components/ppc-report-recipients-card";
import { LsaReportRecipientsCard } from "@/components/lsa-report-recipients-card";
import { CallQualityReportRecipientsCard } from "@/components/call-quality-report-recipients-card";
import { PpcOptimizationAlertRecipientsCard } from "@/components/ppc-optimization-alert-recipients-card";
import { db } from "@/lib/db/client";
import {
  ppcReportRecipients,
  lsaReportRecipients,
  callQualityReportRecipients,
  ppcOptimizationAlertRecipients,
} from "@/lib/db/schema";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  let email: string | null = null;
  try {
    const supabase = await getSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    email = data.user?.email ?? null;
  } catch {
    // Supabase not configured locally; render without identity.
  }

  const [
    recipients,
    lsaRecipients,
    callQualityRecipients,
    optimizationAlertRecipients,
  ] = await Promise.all([
    db.query.ppcReportRecipients.findMany({
      orderBy: asc(ppcReportRecipients.email),
      columns: { id: true, email: true },
    }),
    db.query.lsaReportRecipients.findMany({
      orderBy: asc(lsaReportRecipients.email),
      columns: { id: true, email: true },
    }),
    db.query.callQualityReportRecipients.findMany({
      orderBy: asc(callQualityReportRecipients.email),
      columns: { id: true, email: true },
    }),
    db.query.ppcOptimizationAlertRecipients.findMany({
      orderBy: asc(ppcOptimizationAlertRecipients.email),
      columns: { id: true, email: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="text-xs uppercase text-muted-foreground">Signed in as</div>
            <div className="text-sm">{email ?? "—"}</div>
          </div>
          <SignOutButton />
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div>
          <h2 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Report & alert recipients
          </h2>
          <p className="text-sm text-muted-foreground">
            Exec-facing daily PDF reports, plus alerts on campaign health.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <PpcReportRecipientsCard initial={recipients} />
          <LsaReportRecipientsCard initial={lsaRecipients} />
          <CallQualityReportRecipientsCard initial={callQualityRecipients} />
          <PpcOptimizationAlertRecipientsCard
            initial={optimizationAlertRecipients}
          />
        </div>
      </section>
    </div>
  );
}
