import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Banner } from "@/components/ui/banner";
import { badgeClasses } from "@/components/ui/badge";
import { PpcDateRangeFilter } from "@/components/ppc-date-range-filter";
import { SyncAdsDashboardNowButton } from "@/components/sync-ads-dashboard-now-button";
import { COMPARE_MODES, pctChange, type AdsDashboardWindow } from "@/lib/ads-dashboard-compare";
import { cn } from "@/lib/utils";

// Shared presentation for the three per-client Ads Dashboard reports.
// Server components only (the date filter and sync button are the client
// islands), so every control here is a real link that works before
// hydration.

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const INT = new Intl.NumberFormat("en-US");

export const fmtUsd = (n: number) => USD.format(n);
export const fmtInt = (n: number) => INT.format(Math.round(n));
// Google reports fractional conversions; show a decimal only when there is one.
export const fmtConv = (n: number) =>
  Number.isInteger(Math.round(n * 100) / 100) ? INT.format(Math.round(n)) : n.toFixed(2);
export const fmtCostPerConv = (cost: number, conversions: number) =>
  conversions > 0 ? USD.format(cost / conversions) : "—";

export function fmtDay(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Google reports any impression share under 10% as 0.0999.
export function fmtShare(v: number | null): string {
  if (v === null) return "—";
  if (v < 0.1) return "<10%";
  return `${(v * 100).toFixed(0)}%`;
}

// Percent change against the comparison window. `invert` marks metrics
// where up is bad (cost, cost per conversion).
export function Change({
  current,
  prior,
  invert = false,
  className,
}: {
  current: number;
  prior: number | null;
  invert?: boolean;
  className?: string;
}) {
  if (prior === null) {
    return <span className={cn(badgeClasses("blue", "sm", "rounded-full"), className)}>new</span>;
  }
  const pct = pctChange(current, prior);
  if (pct === null) {
    return (
      <span className={cn("text-[10px] text-muted-foreground", className)}>
        {current === 0 ? "no change" : "from 0"}
      </span>
    );
  }
  if (Math.abs(pct) < 0.5) {
    return <span className={cn("text-[10px] text-muted-foreground", className)}>no change</span>;
  }
  const good = invert ? pct < 0 : pct > 0;
  return (
    <span className={cn(badgeClasses(good ? "green" : "amber", "sm", "rounded-full"), className)}>
      {pct > 0 ? "+" : "−"}
      {Math.abs(pct) >= 1000 ? ">999" : Math.abs(pct).toFixed(0)}%
    </span>
  );
}

const TABS = [
  { key: "conversions", label: "Conversion audit" },
  { key: "search-terms", label: "Search terms" },
  { key: "keywords", label: "Keywords" },
] as const;

export type AdsDashboardTab = (typeof TABS)[number]["key"];

function query(w: AdsDashboardWindow, mode = w.mode): string {
  return `?from=${w.from}&to=${w.to}&compare=${mode}`;
}

export function AdsDashboardHeader({
  client,
  tab,
  window: w,
  showSync = true,
}: {
  client: { id: string; name: string };
  tab: AdsDashboardTab;
  window: AdsDashboardWindow;
  showSync?: boolean;
}) {
  const versus = COMPARE_MODES.find((m) => m.key === w.mode)?.versus ?? "";
  return (
    <>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <Link href={`/ads${query(w)}`} className="hover:text-foreground">
              Ads Dashboard
            </Link>
          </div>
          <h1 className="truncate font-display text-3xl font-bold tracking-tight">{client.name}</h1>
        </div>
        {showSync && (
          <SyncAdsDashboardNowButton
            clientId={client.id}
            range={{ from: w.from, to: w.to }}
            prior={w.prior}
          />
        )}
      </header>

      <nav className="flex flex-wrap gap-1 border-b" aria-label="Ads Dashboard reports">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/ads/${client.id}/${t.key}${query(w)}`}
            aria-current={t.key === tab ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
              t.key === tab
                ? "border-brand text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <Card>
        <CardContent className="space-y-3 p-4">
          <PpcDateRangeFilter from={w.from} to={w.to} />
          <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-xs">
            <span className="text-muted-foreground">Compare</span>
            <div className="inline-flex gap-1">
              {COMPARE_MODES.map((m) => (
                <Link
                  key={m.key}
                  href={query(w, m.key)}
                  aria-current={m.key === w.mode ? "true" : undefined}
                  className={
                    m.key === w.mode
                      ? "rounded-full border border-brand bg-brand/10 px-2.5 py-1 font-medium text-foreground"
                      : "rounded-full border border-border bg-background px-2.5 py-1 text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                  }
                >
                  {m.label}
                </Link>
              ))}
            </div>
            <span className="text-muted-foreground">
              {fmtDay(w.from)} – {fmtDay(w.to)} {versus}: {fmtDay(w.prior.from)} –{" "}
              {fmtDay(w.prior.to)}
            </span>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// Shown when a stored-data report has nothing for one of its two windows.
// The daily cron only keeps the trailing 30 days fresh, so an older
// comparison window is empty until it has been pulled once.
export function StoredDataBanners({
  hasData,
  priorHasData,
  window: w,
}: {
  hasData: boolean;
  priorHasData: boolean;
  window: AdsDashboardWindow;
}) {
  return (
    <>
      {!hasData && (
        <Banner tone="warning" title="No synced data for this date range">
          Nothing is stored for {fmtDay(w.from)} – {fmtDay(w.to)}. Use “Sync both windows” to pull
          it from Google Ads.
        </Banner>
      )}
      {hasData && !priorHasData && (
        <Banner tone="info" title="No synced data for the comparison window">
          Nothing is stored for {fmtDay(w.prior.from)} – {fmtDay(w.prior.to)}, so changes show as
          “new” or “from 0”. Use “Sync both windows” to pull it.
        </Banner>
      )}
    </>
  );
}

export const TH = "px-3 py-2 text-left font-medium";
export const THR = "px-3 py-2 text-right font-medium";
export const TD = "px-3 py-2";
export const TDR = "px-3 py-2 text-right tabular-nums";
export const THEAD = "border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground";
