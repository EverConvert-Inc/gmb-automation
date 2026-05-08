import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listClientsWithRollup } from "@/lib/queries";
import { formatRelativeDate } from "@/lib/utils";
import { ArrowRight, Plus } from "lucide-react";

export const dynamic = "force-dynamic";

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
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Clients</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} clients · GBP rollup across all managed locations
          </p>
        </div>
        <Link href="/clients/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" /> New client
          </Button>
        </Link>
      </div>
      {rows.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 py-12 text-center text-sm text-muted-foreground">
            <p>No clients yet.</p>
            <Link href="/clients/new">
              <Button>
                <Plus className="mr-2 h-4 w-4" /> Create your first client
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Locations</th>
                <th className="px-4 py-3 font-medium">Rating</th>
                <th className="px-4 py-3 font-medium">Reviews</th>
                <th className="px-4 py-3 font-medium">Last scan</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="w-px px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <Link href={`/clients/${c.slug}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{c.locationCount}</td>
                  <td className="px-4 py-3">
                    {c.weightedRating !== null ? c.weightedRating.toFixed(1) : "—"}
                  </td>
                  <td className="px-4 py-3">{c.totalReviews}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatRelativeDate(c.lastScanAt)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={c.status === "active" ? "success" : "secondary"}>
                      {c.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/clients/${c.slug}`}>
                      <Button size="sm" variant="outline">
                        View client
                        <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
