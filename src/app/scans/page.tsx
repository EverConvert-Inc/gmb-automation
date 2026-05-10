import Link from "next/link";
import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { listRecentScansAcrossClients } from "@/lib/queries-scans";
import { formatRelativeDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Recent scans" };

export default async function ScansPage() {
  const rows = await listRecentScansAcrossClients(50);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Recent scans</h1>
        <p className="text-sm text-muted-foreground">Last 50 scans across all clients.</p>
      </div>
      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No scans yet. Open a client and run one from the scan management panel.
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Started</th>
                <th className="px-4 py-3 font-medium">Client / location</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Triggered</th>
                <th className="px-4 py-3 font-medium">Points</th>
                <th className="px-4 py-3 font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const startedAt = new Date(s.startedAt);
                const sameAsClient = s.locationName === s.clientName;
                return (
                  <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td
                      className="px-4 py-3 text-muted-foreground"
                      title={startedAt.toLocaleString()}
                    >
                      {formatRelativeTime(startedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/clients/${s.clientSlug}?location=${s.locationId}`}
                        className="hover:underline"
                      >
                        <span className="font-medium">{s.clientName}</span>
                        {!sameAsClient && (
                          <span className="ml-1 text-muted-foreground">
                            / {s.locationName}
                          </span>
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={
                          s.status === "completed"
                            ? "success"
                            : s.status === "errored"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {s.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{s.triggeredBy}</td>
                    <td className="px-4 py-3">{s.totalPoints}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {s.costEstimate ? `$${Number(s.costEstimate).toFixed(2)}` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return formatRelativeDate(date);
}
