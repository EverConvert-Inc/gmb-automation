"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Map, Search, Settings } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { cn } from "@/lib/utils";

const items = [
  { href: "/clients", label: "Clients", icon: Map },
  { href: "/rankings", label: "Rankings", icon: Search },
  { href: "/scans", label: "Scans", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-16 flex-col bg-brand-dark text-brand-dark-foreground md:w-60">
      <div className="flex h-16 items-center justify-center border-b border-white/10 px-2 md:justify-start md:px-6">
        <Link href="/clients" aria-label="EverConvert home">
          <span className="hidden md:inline">
            <BrandMark />
          </span>
          <span className="font-display text-lg font-bold uppercase text-brand md:hidden">
            EC
          </span>
        </Link>
      </div>
      <nav className="flex flex-col gap-0.5 px-2 py-4 md:px-3">
        {items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-white/10 text-brand"
                  : "text-white/70 hover:bg-white/5 hover:text-white",
              )}
              title={item.label}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-y-1.5 left-0 w-0.5 rounded-r bg-brand"
                />
              )}
              <Icon className="h-4 w-4 shrink-0" />
              <span className="hidden md:inline">{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto px-3 py-4 text-[10px] uppercase tracking-wide text-white/40">
        <span className="hidden md:inline">Local Visibility Platform</span>
      </div>
    </aside>
  );
}
