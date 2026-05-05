import Link from "next/link";
import { notFound } from "next/navigation";
import { LocationAccordion } from "@/components/location-accordion";
import { Button } from "@/components/ui/button";
import { getClientBySlug, listLocationsForClient } from "@/lib/queries";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const client = await getClientBySlug(slug);
  if (!client) notFound();

  const locs = await listLocationsForClient(client.id);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{client.name}</h1>
          <p className="text-sm text-muted-foreground">
            {locs.length} location{locs.length === 1 ? "" : "s"}
          </p>
        </div>
        <Link href={`/clients/${client.slug}/locations/new`}>
          <Button>
            <Plus className="mr-2 h-4 w-4" /> Add location
          </Button>
        </Link>
      </div>
      <LocationAccordion clientSlug={client.slug} locations={locs} />
    </div>
  );
}
