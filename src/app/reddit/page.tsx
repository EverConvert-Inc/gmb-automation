import Link from "next/link";
import type { Metadata } from "next";
import {
  CalendarDays,
  ChartColumnStacked,
  ChevronDown,
  CircleDollarSign,
  Layers,
  MessagesSquare,
  Settings as SettingsIcon,
  Unlink,
  Users,
} from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionCard } from "@/components/ui/section-card";
import { StatTile } from "@/components/ui/stat-tile";
import { DeltaPill } from "@/components/charts";
import { PpcDateRangeFilter } from "@/components/ppc-date-range-filter";
import { SyncRedditNowButton } from "@/components/sync-reddit-now-button";
import { RedditDailySpendChart } from "@/components/reddit-daily-spend-chart";
import { getRedditReport, UNMAPPED_KEY } from "@/lib/queries-reddit";
import { listRedditCredentials } from "@/lib/reddit-ads-token";
import { firstOfMonthIsoEastern, todayIsoEastern } from "@/lib/date-utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Reddit spend" };

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// Truncates to whole cents before converting, same as the PPC report.
function microsToDollars(micros: bigint): number {
  return Number(micros / 10_000n) / 100;
}
const fmtUsd = (micros: bigint) => USD.format(microsToDollars(micros));

function fmtDay(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function fmtWhen(d: Date): string {
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// Standalone Reddit Ads daily spend report. Shares only presentation pieces
// with /ppc and /lsa (date filter, stat tiles, delta pills); its numbers
// come solely from reddit_ads_daily and never feed PPC/LSA totals.
export default async function RedditReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { from: fromParam, to: toParam } = await searchParams;
  // Same default window as /ppc: month to date, today included (partial
  // until Sync Now or the next morning's cron).
  const from = fromParam || firstOfMonthIsoEastern();
  const to = toParam || todayIsoEastern();

  const [credentials, report] = await Promise.all([
    listRedditCredentials(),
    getRedditReport({ from, to }),
  ]);

  const header = (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
      <div>
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Paid Social
        </div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Reddit spend</h1>
      </div>
      {credentials.length > 0 && (
        <div className="flex flex-wrap items-start gap-2">
          <SyncRedditNowButton from={from} to={to} />
          <Link href="/reddit/accounts" className={buttonClasses("outline")}>
            <SettingsIcon className="mr-2 h-4 w-4" /> Manage accounts
          </Link>
        </div>
      )}
    </header>
  );

  if (credentials.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <Card className="surface-brand-tint">
          <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
            <div className="rounded-full bg-brand/10 p-4 ring-1 ring-brand/20">
              <MessagesSquare className="h-7 w-7 text-brand" />
            </div>
            <div className="max-w-md space-y-1.5">
              <p className="text-sm font-semibold">Reddit Ads isn&apos;t connected</p>
              <p className="text-xs text-muted-foreground">
                Connect the agency Reddit login once; every ad account it can see, including
                partner-shared ones, is then discovered and synced daily.
              </p>
            </div>
            <Link href="/reddit/accounts" className={buttonClasses()}>
              Connect Reddit
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const dayCount = report.dates.length;
  const avgDaily = dayCount ? report.totalMicros / BigInt(dayCount) : 0n;
  const share = (micros: bigint) =>
    report.totalMicros > 0n ? `${((Number(micros) / Number(report.totalMicros)) * 100).toFixed(1)}%` : "—";

  return (
    <div className="space-y-6">
      {header}

      <Card>
        <CardContent className="p-4">
          <PpcDateRangeFilter from={from} to={to} />
        </CardContent>
      </Card>

      {report.excludedAccounts.length > 0 && (
        <Banner tone="warning" title="Non-USD accounts excluded from totals">
          {report.excludedAccounts
            .map((a) => `${a.name} (${a.currency ?? "unknown currency"})`)
            .join(", ")}
        </Banner>
      )}
      {report.failingAccounts.length > 0 && (
        <Banner tone="error" title="Last sync failed for some accounts">
          {report.failingAccounts.map((a) => `${a.name}: ${a.error}`).join(" · ")}
        </Banner>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile
          label="Spend"
          value={fmtUsd(report.totalMicros)}
          sublabel={
            <DeltaPill
              current={Math.round(microsToDollars(report.totalMicros))}
              prior={Math.round(microsToDollars(report.priorTotalMicros))}
              invert
            />
          }
          icon={<CircleDollarSign className="h-4 w-4" />}
          tone="brand"
        />
        <StatTile
          label="Avg daily spend"
          value={fmtUsd(avgDaily)}
          sublabel={`${dayCount} day${dayCount === 1 ? "" : "s"}`}
          icon={<CalendarDays className="h-4 w-4" />}
        />
        <StatTile
          label="Active accounts"
          value={String(report.activeAccountCount)}
          sublabel={report.lastSyncAt ? `Last synced ${fmtWhen(report.lastSyncAt)}` : "Not synced yet"}
          icon={<Layers className="h-4 w-4" />}
        />
        <StatTile
          label="Unmapped accounts"
          value={String(report.unmappedAccountCount)}
          sublabel={
            report.unmappedAccountCount > 0 ? (
              <Link href="/reddit/accounts" className="underline underline-offset-2">
                Map to clients
              </Link>
            ) : (
              "All mapped"
            )
          }
          icon={<Unlink className="h-4 w-4" />}
          tone={report.unmappedAccountCount > 0 ? "amber" : "default"}
        />
      </div>

      <SectionCard icon={<Users className="h-4 w-4" />} title="Spend by client" eyebrow={`${fmtDay(from)} – ${fmtDay(to)}`}>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Client</th>
                <th className="px-3 py-2 text-right font-medium">Accounts</th>
                <th className="px-3 py-2 text-right font-medium">Spend</th>
                <th className="px-3 py-2 text-right font-medium">Avg / day</th>
                <th className="px-3 py-2 text-right font-medium">Share</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {report.clients.map((c) => (
                <tr key={c.key}>
                  <td className={`px-3 py-2 ${c.key === UNMAPPED_KEY ? "italic text-muted-foreground" : "font-medium"}`}>
                    {c.name}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.accountCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(c.totalMicros)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtUsd(dayCount ? c.totalMicros / BigInt(dayCount) : 0n)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{share(c.totalMicros)}</td>
                </tr>
              ))}
              {report.clients.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    No USD ad accounts yet.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot className="border-t bg-muted/40 font-semibold">
              <tr>
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {report.clients.reduce((n, c) => n + c.accountCount, 0)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(report.totalMicros)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(avgDaily)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{report.totalMicros > 0n ? "100%" : "—"}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </SectionCard>

      <SectionCard icon={<ChartColumnStacked className="h-4 w-4" />} title="Daily spend" eyebrow="Eastern days, by client">
        <RedditDailySpendChart report={report} />
        {/* Native <details>: collapsed by default, no client JS. */}
        <details className="group mt-4 border-t pt-3">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
            <span className="group-open:hidden">Show daily table</span>
            <span className="hidden group-open:inline">Hide daily table</span>
          </summary>
          <div className="mt-3 overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="sticky left-0 bg-muted px-3 py-2 text-left font-medium">Date</th>
                  {report.clients.map((c) => (
                    <th key={c.key} className="whitespace-nowrap px-3 py-2 text-right font-medium">
                      {c.name}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {report.dates.map((d) => (
                  <tr key={d}>
                    <td className="sticky left-0 whitespace-nowrap bg-card px-3 py-2">{fmtDay(d)}</td>
                    {report.clients.map((c) => (
                      <td key={c.key} className="px-3 py-2 text-right tabular-nums">
                        {fmtUsd(c.byDate[d] ?? 0n)}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {fmtUsd(report.dailyTotals[d] ?? 0n)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t bg-muted/40 font-semibold">
                <tr>
                  <td className="sticky left-0 bg-muted px-3 py-2">Total</td>
                  {report.clients.map((c) => (
                    <td key={c.key} className="px-3 py-2 text-right tabular-nums">
                      {fmtUsd(c.totalMicros)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(report.totalMicros)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </details>
      </SectionCard>
    </div>
  );
}
