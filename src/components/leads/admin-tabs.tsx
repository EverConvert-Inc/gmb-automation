"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/badge";
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

/** The Leads tab's badge: leads hidden from clients by the name rule. */
export const HIDDEN_COUNT_URL = "/api/admin/leads/hidden-count";

/** The admin area's sub-navigation: Firms · Leads · Queue. */
export function AdminTabs() {
  const pathname = usePathname() ?? "";
  const [hidden, setHidden] = useState(0);
  // Fetched after load (and on each navigation) rather than in the layout,
  // which stays free of queries. A failure just means no badge.
  useEffect(() => {
    let live = true;
    fetch(HIDDEN_COUNT_URL, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { hidden?: number } | null) => {
        if (live && typeof b?.hidden === "number") setHidden(b.hidden);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [pathname]);
  return <AdminTabsView pathname={pathname} hiddenCount={hidden} />;
}

/** The tab bar itself, given the path and the badge count. */
export function AdminTabsView({ pathname, hiddenCount }: { pathname: string; hiddenCount: number }) {
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
          {t.href === "/admin/leads" && hiddenCount > 0 ? (
            <Badge
              variant="warning"
              size="sm"
              className="ml-1.5"
              title={`${hiddenCount} hidden from clients: no usable name`}
            >
              {hiddenCount}
            </Badge>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
