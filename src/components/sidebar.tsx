"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import {
  AlertTriangle,
  Gauge,
  Map,
  Megaphone,
  MessageCircle,
  MessagesSquare,
  PhoneCall,
  Settings,
  ShieldCheck,
  Target,
  X,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { SeoApiSpendIndicator } from "@/components/seo-api-spend-indicator";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

type NavChild = { href: string; label: string; exact?: boolean };
type NavItem = {
  href: string;
  label: string;
  icon: typeof Map;
  // Path prefix that marks the whole section (and its children) active. When
  // unset the item's own href is used.
  base?: string;
  children?: readonly NavChild[];
};

// Rankings and Scans are intentionally omitted: both depend on DataForSEO
// SERP credits, which the account may not have. Their routes still exist —
// they are just unlinked from the nav until credits are topped up.
const items: readonly NavItem[] = [
  { href: "/clients", label: "Clients", icon: Map },
  { href: "/ppc", label: "PPC", icon: Megaphone },
  {
    href: "/ads/overview",
    label: "Google Ads",
    icon: Target,
    base: "/ads",
    children: [
      { href: "/ads/overview", label: "Overview" },
      { href: "/ads", label: "Account health", exact: true },
      { href: "/ads/pacing", label: "Pacing" },
      { href: "/ads/audit", label: "Audit" },
      { href: "/ads/standards", label: "Standards" },
    ],
  },
  { href: "/lsa", label: "LSA", icon: PhoneCall },
  { href: "/reddit", label: "Reddit", icon: MessagesSquare },
  { href: "/whatsapp", label: "WhatsApp", icon: MessageCircle },
  { href: "/call-quality", label: "Call Quality", icon: Gauge },
  { href: "/takedowns", label: "Takedowns", icon: AlertTriangle },
];

// Admin and settings sit below a divider at the end of the nav.
const endItems: readonly NavItem[] = [
  // The lead tracker's admin area: firms, every firm's leads, the queue.
  // Active on any /admin page.
  { href: "/admin", label: "Admin", icon: ShieldCheck },
  { href: "/settings", label: "Settings", icon: Settings },
];

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

  const renderItem = (item: NavItem) => {
    const sectionBase = item.base ?? item.href;
    const active =
      pathname === sectionBase || pathname.startsWith(sectionBase + "/");
    const Icon = item.icon;
    return (
      <div key={item.href}>
        <Link
          href={item.href}
          className={cn(
            "group relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
            active
              ? "bg-brand-dark-foreground/10 text-brand"
              : "text-brand-dark-foreground/70 hover:bg-brand-dark-foreground/5 hover:text-brand-dark-foreground",
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
        {item.children && active && (
          <div className="mt-0.5 flex flex-col gap-0.5">
            {item.children.map((child) => {
              const childActive = child.exact
                ? pathname === child.href
                : pathname === child.href || pathname.startsWith(child.href + "/");
              return (
                <Link
                  key={child.href}
                  href={child.href}
                  className={cn(
                    "rounded-md py-1.5 pl-11 pr-3 text-[13px] transition-colors",
                    childActive
                      ? "font-medium text-brand"
                      : "text-brand-dark-foreground/60 hover:bg-brand-dark-foreground/5 hover:text-brand-dark-foreground",
                  )}
                >
                  {child.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const navLinks = (
    <nav className="flex flex-col gap-0.5 px-3 py-4">
      {items.map(renderItem)}
      <div
        aria-hidden
        className="my-2 border-t border-brand-dark-foreground/10"
      />
      {endItems.map(renderItem)}
    </nav>
  );

  return (
    <>
      {/* Desktop sidebar — always visible at md+ */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-brand-dark text-brand-dark-foreground md:flex">
        <div className="flex h-16 items-center border-b border-brand-dark-foreground/10 px-6">
          <Link href="/clients" aria-label="EverConvert home">
            <BrandMark />
          </Link>
        </div>
        {navLinks}
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-brand-dark-foreground/10 px-3 py-3">
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
          "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[80vw] flex-col border-r border-border bg-brand-dark text-brand-dark-foreground shadow-2xl transition-transform duration-200 md:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-brand-dark-foreground/10 px-4">
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
            className="rounded-md p-2 text-brand-dark-foreground/70 hover:bg-brand-dark-foreground/10 hover:text-brand-dark-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {navLinks}
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-brand-dark-foreground/10 px-3 py-3">
          <SeoApiSpendIndicator />
          <ThemeToggle />
        </div>
      </aside>
    </>
  );
}
