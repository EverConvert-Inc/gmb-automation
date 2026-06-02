import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SignOutButton } from "@/components/sign-out-button";
import { PpcReportRecipientsCard } from "@/components/ppc-report-recipients-card";
import { db } from "@/lib/db/client";
import { ppcReportRecipients } from "@/lib/db/schema";
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

  const recipients = await db.query.ppcReportRecipients.findMany({
    orderBy: asc(ppcReportRecipients.email),
    columns: { id: true, email: true },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
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
      <PpcReportRecipientsCard initial={recipients} />
    </div>
  );
}
