import { notFound } from "next/navigation";
import { LocationAccordion } from "@/components/location-accordion";
import { getClientBySlug, listLocationsForClient } from "@/lib/queries";

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
      <div>
        <h1 className="text-2xl font-semibold">{client.name}</h1>
        <p className="text-sm text-muted-foreground">
          {locs.length} location{locs.length === 1 ? "" : "s"}
        </p>
      </div>
      <LocationAccordion clientSlug={client.slug} locations={locs} />
    </div>
  );
}
