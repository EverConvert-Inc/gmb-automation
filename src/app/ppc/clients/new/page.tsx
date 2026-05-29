import Link from "next/link";
import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewPpcClientForm } from "@/components/new-ppc-client-form";

export const metadata: Metadata = { title: "New PPC client" };

export default function NewPpcClientPage() {
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link
          href="/ppc/clients"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          &larr; PPC clients
        </Link>
        <h1 className="mt-2 font-display text-2xl font-bold tracking-tight">
          Add PPC client
        </h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Client details</CardTitle>
        </CardHeader>
        <CardContent>
          <NewPpcClientForm />
        </CardContent>
      </Card>
    </div>
  );
}
