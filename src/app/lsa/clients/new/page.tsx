import Link from "next/link";
import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewLsaClientForm } from "@/components/new-lsa-client-form";

export const metadata: Metadata = { title: "New LSA client" };

export default function NewLsaClientPage() {
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link
          href="/lsa/clients"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          &larr; LSA clients
        </Link>
        <h1 className="mt-2 font-display text-2xl font-bold tracking-tight">
          Add LSA client
        </h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Client details</CardTitle>
        </CardHeader>
        <CardContent>
          <NewLsaClientForm />
        </CardContent>
      </Card>
    </div>
  );
}
