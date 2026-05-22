"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/sidebar";

// Routes that render full-bleed without the sidebar chrome (e.g. /login).
const FULL_BLEED_ROUTES = ["/login"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
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
      <Sidebar />
      <main className="ml-16 min-h-screen md:ml-60">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
