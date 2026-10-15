"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { PORTAL_ROOT_ID } from "../_lib/theme";

/**
 * The portal header: no rule underneath, the same colour as the page, and a
 * soft shadow only once the page has scrolled. The portal scrolls inside its
 * own root element, not the window, so that is what is watched.
 */
export function PortalHeader({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const root = document.getElementById(PORTAL_ROOT_ID);
    if (!root) return;
    const onScroll = () => setScrolled(root.scrollTop > 4);
    onScroll();
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      data-scrolled={scrolled || undefined}
      className={cn(
        "sticky top-0 z-10 bg-background/85 backdrop-blur transition-shadow duration-200 supports-[backdrop-filter]:bg-background/70",
        scrolled && "shadow-[0_1px_12px_-4px_rgb(0_0_0/0.12)]",
      )}
    >
      {children}
    </header>
  );
}
