import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KeywordManagementCard } from "@/components/keyword-management-card";
import { METRO_LOCATIONS } from "@/lib/dataforseo";
import { getClientBySlug } from "@/lib/queries";

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

  const cities = Object.keys(METRO_LOCATIONS).sort();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
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
        <Link href={`/clients/${client.slug}`}>
          <Button variant="outline" size="sm">
            View rankings
          </Button>
        </Link>
      </div>

      <KeywordManagementCard
        clientId={client.id}
        clientSlug={client.slug}
        cities={cities}
      />
    </div>
  );
}
