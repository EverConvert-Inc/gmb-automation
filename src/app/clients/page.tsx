import Link from "next/link";
import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { buttonClasses } from "@/components/ui/button";
import { ClientsTable } from "@/components/clients-table";
import {
  listClientsWithRollup,
  listLocationSnapshots,
  type LocationSnapshot,
} from "@/lib/queries";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientListPage() {
  let rows;
  try {
    rows = await listClientsWithRollup();
  } catch (err) {
    console.error("[/clients] listClientsWithRollup failed:", err);
    return (
      <Card>
        <CardContent className="space-y-2 py-8 text-sm">
          <p className="font-medium">Could not load clients.</p>
          <pre className="overflow-auto rounded bg-muted p-3 text-xs">
            {err instanceof Error ? err.message : String(err)}
          </pre>
          <p className="text-muted-foreground">
            Check that DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, and
            NEXT_PUBLIC_SUPABASE_ANON_KEY are set in this Vercel environment.
          </p>
        </CardContent>
      </Card>
    );
  }

  const snapshotMap = await listLocationSnapshots(rows.map((r) => r.id));
  const snapshots: Record<string, LocationSnapshot[]> = {};
  for (const [clientId, locs] of snapshotMap) snapshots[clientId] = locs;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Clients</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} clients · performance summary across all client locations
          </p>
        </div>
        <Link
          href="/clients/new"
          className={buttonClasses("default", "default", "whitespace-nowrap")}
        >
          <Plus className="mr-2 h-4 w-4" /> New client
        </Link>
      </div>
      {rows.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 py-12 text-center text-sm text-muted-foreground">
            <p>No clients yet.</p>
            <Link href="/clients/new" className={buttonClasses()}>
              <Plus className="mr-2 h-4 w-4" /> Create your first client
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Click a row to peek at each location&rsquo;s reviews and most recent
            scan. Use <span className="font-medium text-foreground">View client</span> for
            the full dashboard.
          </p>
          <ClientsTable rows={rows} snapshots={snapshots} />
        </>
      )}
    </div>
  );
}
