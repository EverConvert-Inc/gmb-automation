"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
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
  const [pending, startTransition] = useTransition();

  function go(locId: string) {
    if (locId === currentLocationId) return;
    startTransition(() => {
      // push() updates the URL but the Next.js Router Cache may serve a
      // stale RSC payload for the same route segment when only the
      // searchParam changes — refresh() invalidates that cache and
      // re-fetches fresh server-rendered data for the new location.
      router.push(`/clients/${clientSlug}?location=${locId}`, { scroll: false });
      router.refresh();
    });
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
            disabled={pending}
            className={cn(
              "-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              active
                ? "border-primary bg-muted/40 text-foreground"
                : "border-transparent text-muted-foreground hover:bg-muted/30 hover:text-foreground",
              pending && "opacity-60",
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
