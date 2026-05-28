"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Item = { id: string; label: string };

// Sticky in-page anchor nav. Renders a pill bar; the active pill tracks
// which section is currently in view via IntersectionObserver so the nav
// feels alive as you scroll. Hidden on small screens (no value when each
// section already fills the viewport).
export function DashboardNav({ items }: { items: Item[] }) {
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the topmost section currently intersecting; falls back to the
        // last one we saw if nothing is on-screen mid-scroll.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      {
        // Trigger when the section's top edge is ~120px below the viewport
        // top — accounts for the sticky nav itself and the page padding.
        rootMargin: "-120px 0px -60% 0px",
        threshold: 0,
      },
    );
    const els = items
      .map((i) => document.getElementById(i.id))
      .filter((el): el is HTMLElement => el !== null);
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav className="sticky top-0 z-20 -mx-4 hidden border-b border-border/60 bg-background/80 px-4 py-2 backdrop-blur sm:-mx-6 sm:flex sm:px-6 md:top-0">
      <div className="flex flex-wrap gap-1 text-xs">
        {items.map((it) => (
          <a
            key={it.id}
            href={`#${it.id}`}
            className={cn(
              "rounded-full px-3 py-1.5 font-medium transition-colors",
              active === it.id
                ? "bg-brand/15 text-brand"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {it.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
