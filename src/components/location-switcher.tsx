"use client";

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
  function go(locId: string) {
    if (locId === currentLocationId) return;
    // Hard navigation. router.push + key-based remount under React 19 +
    // dynamic()-imported leaflet was producing one of two failure modes:
    //   - two heat maps stacked (when react-leaflet didn't unmount)
    //   - "Map container is being reused" crash (when we forced cleanup)
    // A full reload sidesteps both by giving leaflet a brand-new
    // document. Slight page flash on switch, but guaranteed-correct.
    window.location.assign(`/clients/${clientSlug}?location=${locId}`);
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
