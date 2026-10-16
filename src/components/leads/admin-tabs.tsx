"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export const ADMIN_TABS = [
  { href: "/admin/firms", label: "Firms" },
  { href: "/admin/leads", label: "Leads" },
  { href: "/admin/leads/queue", label: "Queue" },
] as const;

/** The tab for a path: the most specific tab whose href the path is, or is under. */
export function activeAdminTab(pathname: string): string | null {
  const matches = ADMIN_TABS.filter((t) => pathname === t.href || pathname.startsWith(`${t.href}/`));
  return matches.sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
}

/** The admin area's sub-navigation: Firms · Leads · Queue. */
export function AdminTabs() {
  const pathname = usePathname() ?? "";
  const active = activeAdminTab(pathname);
  return (
    <nav aria-label="Admin" className="mb-6 flex gap-1 border-b">
      {ADMIN_TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={active === t.href ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            active === t.href
              ? "border-brand text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
