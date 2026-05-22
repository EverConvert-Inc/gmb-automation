import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { KeywordManagementCard } from "@/components/keyword-management-card";
import { getClientBySlug, listLocationsForClient } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const client = await getClientBySlug(slug);
  return { title: client ? `${client.name} · Keywords` : "Keywords" };
}

export default async function KeywordsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const client = await getClientBySlug(slug);
  if (!client) notFound();

  // Pre-fill the new-keyword form's target URL with the first location's
  // website (from Google Places). Saves the user from typing — they can
  // override per-keyword. No website on any location → no suggestion.
  const locs = await listLocationsForClient(client.id);
  const suggestedUrl =
    locs.find((l) => l.placeWebsiteUri)?.placeWebsiteUri ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="space-y-1">
          <Link
            href={`/clients/${client.slug}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to {client.name}
          </Link>
          <h1 className="text-2xl font-semibold">Tracked keywords</h1>
          <p className="text-sm text-muted-foreground">
            Organic SERP rankings for {client.name}. Scans run every Thursday;
            use &ldquo;Scan now&rdquo; for an ad-hoc check.
          </p>
        </div>
        <Link
          href={`/clients/${client.slug}`}
          className={buttonClasses("outline", "sm")}
        >
          View rankings
        </Link>
      </div>

      <KeywordManagementCard
        clientId={client.id}
        clientSlug={client.slug}
        suggestedTargetUrl={suggestedUrl}
      />
    </div>
  );
}
