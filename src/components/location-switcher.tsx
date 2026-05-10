import Link from "next/link";
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
  return (
    <div
      role="tablist"
      aria-label="Locations"
      className="flex gap-1 overflow-x-auto border-b"
    >
      {locations.map((loc) => {
        const active = loc.id === currentLocationId;
        return (
          <Link
            key={loc.id}
            href={`/clients/${clientSlug}?location=${loc.id}`}
            role="tab"
            aria-selected={active}
            scroll={false}
            className={cn(
              "-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              active
                ? "border-primary bg-muted/40 text-foreground"
                : "border-transparent text-muted-foreground hover:bg-muted/30 hover:text-foreground",
            )}
          >
            <MapPin className="h-3.5 w-3.5" />
            {loc.name}
          </Link>
        );
      })}
    </div>
  );
}
