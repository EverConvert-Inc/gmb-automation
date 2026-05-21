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
    // Not wrapped in a transition: the heat map is a dynamic() import, and
    // React 19 keeps the old subtree mounted across a transition while the
    // new one suspends — that paints two maps stacked during the swap.
    // Direct push + refresh forces a synchronous unmount of the old tree.
    router.push(`/clients/${clientSlug}?location=${locId}`, { scroll: false });
    router.refresh();
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
