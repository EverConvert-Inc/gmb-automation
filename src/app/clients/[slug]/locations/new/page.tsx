import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewLocationForm } from "@/components/new-location-form";
import { getClientBySlug } from "@/lib/queries";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const client = await getClientBySlug(slug);
  return { title: client ? `Add location · ${client.name}` : "Add location" };
}

export default async function NewLocationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const client = await getClientBySlug(slug);
  if (!client) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Add location for {client.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <NewLocationForm clientId={client.id} clientSlug={client.slug} />
        </CardContent>
      </Card>
    </div>
  );
}
