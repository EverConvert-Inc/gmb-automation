import Link from "next/link";
import { MapPin, Plus } from "lucide-react";
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
      className="flex gap-2 overflow-x-auto border-b pb-px"
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
              "inline-flex shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-border bg-card text-foreground"
                : "border-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground",
            )}
          >
            <MapPin className="h-3.5 w-3.5" />
            {loc.name}
          </Link>
        );
      })}
      <Link
        href={`/clients/${clientSlug}/locations/new`}
        className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 border-dashed px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" />
        Add location
      </Link>
    </div>
  );
}
