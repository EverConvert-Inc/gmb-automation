"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { recencyColor, formatRelativeDate } from "@/lib/utils";
import { ChevronDown, MapPin, Star } from "lucide-react";
import type { LocationCardRow } from "@/lib/queries";

function StarBar({ rating }: { rating: number | null }) {
  if (rating === null) return <span className="text-muted-foreground">—</span>;
  const full = Math.round(rating);
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={i <= full ? "h-4 w-4 fill-yellow-400 text-yellow-400" : "h-4 w-4 text-muted-foreground"}
        />
      ))}
      <span className="ml-1 text-sm font-medium">{rating.toFixed(1)}</span>
    </div>
  );
}

export function LocationAccordion({
  clientSlug,
  locations,
}: {
  clientSlug: string;
  locations: LocationCardRow[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (locations.length === 0) {
    return (
      <div className="rounded-lg border p-12 text-center text-sm text-muted-foreground">
        No locations for this client yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {locations.map((loc) => {
        const open = openId === loc.id;
        return (
          <div key={loc.id} className="overflow-hidden rounded-lg border bg-card">
            <button
              type="button"
              className="flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-muted/30"
              onClick={() => setOpenId(open ? null : loc.id)}
            >
              <ChevronDown
                className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{loc.name}</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    {loc.address}
                  </span>
                </div>
              </div>
              <div className="hidden items-center gap-8 md:flex">
                <StarBar rating={loc.rating} />
                <div className="text-sm">
                  <span className="font-medium">{loc.reviewCount}</span>
                  <span className="ml-1 text-muted-foreground">reviews</span>
                </div>
                <div className={`text-sm ${recencyColor(loc.daysSinceLastReview)}`}>
                  {loc.daysSinceLastReview === null
                    ? "no reviews"
                    : `${loc.daysSinceLastReview}d since last`}
                </div>
                <div className="text-sm">
                  {loc.latestScan?.arp !== null && loc.latestScan?.arp !== undefined ? (
                    <>
                      <span className="font-medium">ARP {loc.latestScan.arp.toFixed(1)}</span>
                      <span className="ml-2 text-muted-foreground">
                        SoLV {loc.latestScan.solv?.toFixed(0) ?? "—"}%
                      </span>
                    </>
                  ) : (
                    <Badge variant="secondary">no scan</Badge>
                  )}
                </div>
              </div>
            </button>
            {open && (
              <div className="border-t bg-muted/10 p-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                      Latest scan
                    </div>
                    {loc.latestScan ? (
                      <div className="text-sm">
                        Completed {formatRelativeDate(loc.latestScan.completedAt)}
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">No scans yet.</div>
                    )}
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <Link href={`/clients/${clientSlug}/locations/${loc.id}`}>
                      <Button size="sm" variant="outline">
                        View Full Heat Map
                      </Button>
                    </Link>
                    <Link
                      href={`/clients/${clientSlug}/locations/${loc.id}#reviews`}
                    >
                      <Button size="sm" variant="outline">
                        View All Reviews
                      </Button>
                    </Link>
                    <RunScanButton locationId={loc.id} />
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RunScanButton({ locationId }: { locationId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/scans/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId, triggeredBy: "manual" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-600">{error}</span>}
      <Button size="sm" disabled={busy} onClick={run}>
        {busy ? "Dispatching…" : "Run New Scan"}
      </Button>
    </div>
  );
}
