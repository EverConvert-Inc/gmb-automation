"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Sidebar } from "@/components/sidebar";

// Routes that render full-bleed without the sidebar chrome (e.g. /login).
const FULL_BLEED_ROUTES = ["/login"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const fullBleed = FULL_BLEED_ROUTES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

  if (fullBleed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        {children}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />

      {/* Mobile top bar — sticky, only shown < md. Houses the hamburger
          and the brand mark. Sidebar lives behind it as a slide-in drawer. */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-white/10 bg-brand-dark px-4 text-white md:hidden">
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open navigation"
          aria-expanded={mobileNavOpen}
          className="-ml-2 rounded-md p-2 text-white/80 hover:bg-white/10 hover:text-white"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link
          href="/clients"
          className="font-display text-lg font-bold uppercase text-brand"
        >
          EverConvert
        </Link>
        {/* Empty spacer keeps brand centered. */}
        <span className="w-9" aria-hidden />
      </header>

      <main className="min-h-screen md:ml-60">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
