"use client";

import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

export type LocationSwitcherItem = {
  id: string;
  name: string;
};

export function LocationSwitcher({
  clientSlug,
  locations,
  currentLocationId,
}: {
  clientSlug: string;
  locations: LocationSwitcherItem[];
  currentLocationId: string | null;
}) {
  const router = useRouter();

  function go(locId: string) {
    if (locId === currentLocationId) return;
    // router.push() alone — no refresh, no transition. The page is
    // force-dynamic so push fetches a fresh RSC payload anyway. Calling
    // refresh on top of push was triggering a second concurrent render
    // that kept the previous location's HeatMap mounted alongside the new
    // one (Leaflet maps don't like overlapping React reconciliation).
    router.push(`/clients/${clientSlug}?location=${locId}`, { scroll: false });
  }

  return (
    <div
      role="tablist"
      aria-label="Locations"
      className="flex gap-1 overflow-x-auto border-b"
    >
      {locations.map((loc) => {
        const active = loc.id === currentLocationId;
        return (
          <button
            key={loc.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => go(loc.id)}
            className={cn(
              "-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              active
                ? "border-primary bg-muted/40 text-foreground"
                : "border-transparent text-muted-foreground hover:bg-muted/30 hover:text-foreground",
            )}
          >
            <MapPin className="h-3.5 w-3.5" />
            {loc.name}
          </button>
        );
      })}
    </div>
  );
}
