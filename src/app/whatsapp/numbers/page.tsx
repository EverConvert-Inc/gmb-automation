import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { asc } from "drizzle-orm";
import { ArrowLeft, KeyRound, Phone } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { SectionCard } from "@/components/ui/section-card";
import { WhatsappDiscoverButton, WhatsappNumbersTable } from "@/components/whatsapp-numbers";
import { db } from "@/lib/db/client";
import { whatsappNumbers } from "@/lib/db/schema";
import { GRAPH_API_VERSION } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "WhatsApp numbers" };

const REQUIRED_ENV = [
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
  "WHATSAPP_BUSINESS_ID",
] as const;

// Connection checklist plus every number in the portfolio, with our label
// (usually the client) and whether it shows in the inbox.
export default async function WhatsappNumbersPage() {
  const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
  const numbers = await db.query.whatsappNumbers.findMany({
    orderBy: [asc(whatsappNumbers.label), asc(whatsappNumbers.displayPhoneNumber)],
  });
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "your-app.vercel.app";
  const callbackUrl = `https://${host}/api/webhooks/whatsapp`;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-1">
        <Link
          href="/whatsapp"
          className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-1 h-3 w-3" /> WhatsApp inbox
        </Link>
        <h1 className="text-2xl font-semibold">WhatsApp numbers</h1>
        <p className="text-sm text-muted-foreground">
          Every number in EverConvert&apos;s Meta business portfolio. Give each one a label so the
          inbox shows which client it belongs to.
        </p>
      </div>

      {missingEnv.length > 0 && (
        <Banner tone="warning" title="WhatsApp isn't fully configured">
          Missing environment variables: {missingEnv.join(", ")}.
        </Banner>
      )}

      <SectionCard icon={<KeyRound className="h-4 w-4" />} title="Connection">
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>
            In Meta Business Settings, create a <strong>system user</strong> (admin), assign it the
            WhatsApp accounts and the app, and generate a token with{" "}
            <code>whatsapp_business_messaging</code>, <code>whatsapp_business_management</code> and{" "}
            <code>business_management</code>. Set it as <code>WHATSAPP_ACCESS_TOKEN</code>, and the
            portfolio&apos;s id as <code>WHATSAPP_BUSINESS_ID</code>.
          </li>
          <li>
            From the app&apos;s dashboard (App settings &rsaquo; Basic), set the app secret as{" "}
            <code>WHATSAPP_APP_SECRET</code>. Pick any random string for{" "}
            <code>WHATSAPP_WEBHOOK_VERIFY_TOKEN</code>.
          </li>
          <li>
            In the app&apos;s WhatsApp &rsaquo; Configuration, set the callback URL to{" "}
            <code className="break-all">{callbackUrl}</code> with that verify token, and subscribe
            to the <code>messages</code> field.
          </li>
          <li>
            Click <strong>Refresh from Meta</strong> below. It pulls in every number and switches on
            webhooks for each WhatsApp account.
          </li>
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">Graph API {GRAPH_API_VERSION}.</p>
      </SectionCard>

      <SectionCard
        icon={<Phone className="h-4 w-4" />}
        title="Numbers"
        eyebrow={numbers.length ? `${numbers.length} number${numbers.length === 1 ? "" : "s"}` : undefined}
        actions={<WhatsappDiscoverButton />}
      >
        <WhatsappNumbersTable
          numbers={numbers.map((n) => ({
            id: n.id,
            phoneNumberId: n.phoneNumberId,
            wabaId: n.wabaId,
            displayPhoneNumber: n.displayPhoneNumber,
            verifiedName: n.verifiedName,
            label: n.label,
            qualityRating: n.qualityRating,
            platformType: n.platformType,
            codeVerificationStatus: n.codeVerificationStatus,
            isActive: n.isActive,
          }))}
        />
      </SectionCard>
    </div>
  );
}
