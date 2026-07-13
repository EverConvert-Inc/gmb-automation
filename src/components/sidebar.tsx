"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Activity, Map, Megaphone, PhoneCall, Search, Settings, X } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { SeoApiSpendIndicator } from "@/components/seo-api-spend-indicator";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

const items = [
  { href: "/clients", label: "Clients", icon: Map },
  { href: "/rankings", label: "Rankings", icon: Search },
  { href: "/ppc", label: "PPC", icon: Megaphone },
  { href: "/lsa", label: "LSA", icon: PhoneCall },
  { href: "/scans", label: "Scans", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

type Props = {
  mobileOpen: boolean;
  onMobileClose: () => void;
};

export function Sidebar({ mobileOpen, onMobileClose }: Props) {
  const pathname = usePathname();

  // Close the mobile drawer on route change. Without this, tapping a nav
  // item swaps the page underneath but the drawer stays sitting on top.
  useEffect(() => {
    onMobileClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const navLinks = (
    <nav className="flex flex-col gap-0.5 px-3 py-4">
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
          >
            {active && (
              <span
                aria-hidden
                className="absolute inset-y-1.5 left-0 w-0.5 rounded-r bg-brand"
              />
            )}
            <Icon className="h-4 w-4 shrink-0" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Desktop sidebar — always visible at md+ */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-brand-dark text-brand-dark-foreground md:flex">
        <div className="flex h-16 items-center border-b border-white/10 px-6">
          <Link href="/clients" aria-label="EverConvert home">
            <BrandMark />
          </Link>
        </div>
        {navLinks}
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-white/10 px-3 py-3">
          <SeoApiSpendIndicator />
          <ThemeToggle />
        </div>
      </aside>

      {/* Mobile drawer overlay — backdrop dim + tap-to-close */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={onMobileClose}
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
        />
      )}

      {/* Mobile drawer — slides in from the left when mobileOpen is true */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[80vw] flex-col bg-brand-dark text-brand-dark-foreground shadow-2xl transition-transform duration-200 md:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-white/10 px-4">
          <Link
            href="/clients"
            aria-label="EverConvert home"
            onClick={onMobileClose}
          >
            <BrandMark />
          </Link>
          <button
            type="button"
            onClick={onMobileClose}
            aria-label="Close menu"
            className="rounded-md p-2 text-white/70 hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {navLinks}
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-white/10 px-3 py-3">
          <SeoApiSpendIndicator />
          <ThemeToggle />
        </div>
      </aside>
    </>
  );
}
