import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Banner } from "@/components/ui/banner";
import { badgeClasses } from "@/components/ui/badge";
import { PpcDateRangeFilter } from "@/components/ppc-date-range-filter";
import { SyncAdsDashboardNowButton } from "@/components/sync-ads-dashboard-now-button";
import {
  COMPARE_MODES,
  describeChange,
  isFullySynced,
  type AdsDashboardWindow,
  type WindowCoverage,
} from "@/lib/ads-dashboard-compare";
import { formatImpressionShare } from "@/lib/ads-impression-share";
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

// Impression share, with Google's 0.0999 floor shown as "<10%".
export const fmtShare = formatImpressionShare;

// Percent change against the comparison window. `invert` marks metrics
// where up is bad (cost, cost per conversion). `comparable={false}` means one
// of the two windows is not fully synced: the stored figures are incomplete,
// so no change is printed at all.
export function Change({
  current,
  prior,
  invert = false,
  comparable = true,
  className,
}: {
  current: number;
  prior: number | null;
  invert?: boolean;
  comparable?: boolean;
  className?: string;
}) {
  const muted = cn("text-[10px] text-muted-foreground", className);
  if (!comparable) {
    return (
      <span className={muted} title="One of the two windows is not fully synced, so a change would compare against incomplete data.">
        partial data
      </span>
    );
  }
  const change = describeChange(current, prior);
  if (change.kind === "new") {
    return <span className={cn(badgeClasses("blue", "sm", "rounded-full"), className)}>new</span>;
  }
  if (change.kind === "none") return <span className={muted}>no change</span>;
  if (change.kind === "na") {
    return (
      <span className={muted} title="The comparison figure is too close to zero for a percentage to mean anything.">
        n/a
      </span>
    );
  }
  const good = invert ? change.pct < 0 : change.pct > 0;
  return (
    <span className={cn(badgeClasses(good ? "green" : "amber", "sm", "rounded-full"), className)}>
      {change.pct > 0 ? "+" : "−"}
      {Math.abs(change.pct).toFixed(0)}%
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
          <Link
            href={`/ads${query(w)}`}
            className="mb-1 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            All accounts
          </Link>
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
  coverage,
  priorCoverage,
  window: w,
}: {
  coverage: WindowCoverage;
  priorCoverage: WindowCoverage;
  window: AdsDashboardWindow;
}) {
  const days = (c: WindowCoverage) => `${c.syncedDays} of ${c.totalDays} days`;
  const currentOk = isFullySynced(coverage);
  return (
    <>
      {coverage.syncedDays === 0 && (
        <Banner tone="warning" title="No synced data for this date range">
          Nothing is stored for {fmtDay(w.from)} – {fmtDay(w.to)}. Use “Sync both windows” to pull
          it from Google Ads.
        </Banner>
      )}
      {coverage.syncedDays > 0 && !currentOk && (
        <Banner tone="warning" title="This date range is only partly synced">
          {days(coverage)} of {fmtDay(w.from)} – {fmtDay(w.to)} are stored, so the figures below are
          incomplete and no change is shown. Use “Sync both windows” to pull the rest.
        </Banner>
      )}
      {currentOk && !isFullySynced(priorCoverage) && (
        <Banner
          tone="info"
          title={
            priorCoverage.syncedDays === 0
              ? "The comparison window is not synced"
              : "The comparison window is only partly synced"
          }
        >
          {days(priorCoverage)} of {fmtDay(w.prior.from)} – {fmtDay(w.prior.to)} are stored, so no
          change is shown. Use “Sync both windows” to pull it.
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
