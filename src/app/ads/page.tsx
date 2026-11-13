import Link from "next/link";
import type { Metadata } from "next";
import { Target } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { SectionCard } from "@/components/ui/section-card";
import { fmtConv, fmtDay, fmtInt, fmtUsd, TD, TDR, TH, THEAD, THR } from "@/components/ads-dashboard-ui";
import { listAdsDashboardClients } from "@/lib/queries-ads-dashboard";
import { resolveWindow } from "@/lib/ads-dashboard-compare";
import { daysAgoIsoEastern, yesterdayIsoEastern } from "@/lib/date-utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Ads Dashboard" };

function fmtWhen(d: Date): string {
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// Client picker for the Ads Dashboard: every active PPC client with a
// linked Google Ads account, ranked by Search spend in the window.
export default async function AdsDashboardIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; compare?: string }>;
}) {
  const w = resolveWindow(await searchParams, {
    from: daysAgoIsoEastern(30),
    to: yesterdayIsoEastern(),
  });
  const clients = await listAdsDashboardClients({ from: w.from, to: w.to });
  const q = `?from=${w.from}&to=${w.to}&compare=${w.mode}`;
  const neverSynced = clients.filter((c) => !c.lastSyncAt && !c.lastSyncFailed).length;

  return (
    <div className="space-y-6">
      <header>
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Google Ads
        </div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Ads Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search terms, keywords and a conversion-action audit for each PPC client. Search campaigns
          only — Performance Max is not included.
        </p>
      </header>

      {clients.length > 0 && neverSynced === clients.length && (
        <Banner tone="info" title="Nothing has been synced yet">
          Search-term and keyword data arrives with the daily sync. The conversion audit reads Google
          Ads live and works straight away.
        </Banner>
      )}

      <SectionCard
        icon={<Target className="h-4 w-4" />}
        title="Clients"
        eyebrow={`Search campaigns · ${fmtDay(w.from)} – ${fmtDay(w.to)}`}
      >
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className={THEAD}>
              <tr>
                <th className={TH}>Client</th>
                <th className={THR}>Search spend</th>
                <th className={THR}>Clicks</th>
                <th className={THR}>Conversions</th>
                <th className={TH}>Last synced</th>
                <th className={TH}>Reports</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {clients.map((c) => (
                <tr key={c.id}>
                  <td className={`${TD} font-medium`}>
                    <Link href={`/ads/${c.id}/conversions${q}`} className="hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className={TDR}>{fmtUsd(c.searchCost)}</td>
                  <td className={TDR}>{fmtInt(c.searchClicks)}</td>
                  <td className={TDR}>{fmtConv(c.searchConversions)}</td>
                  <td className={`${TD} text-xs text-muted-foreground`}>
                    {c.lastSyncFailed ? (
                      <span className="text-red-700 dark:text-red-400" title={c.lastSyncFailed}>
                        Last sync failed
                      </span>
                    ) : c.lastSyncAt ? (
                      fmtWhen(c.lastSyncAt)
                    ) : (
                      "Not synced yet"
                    )}
                  </td>
                  <td className={`${TD} whitespace-nowrap text-xs`}>
                    <Link href={`/ads/${c.id}/conversions${q}`} className="underline underline-offset-2">
                      Audit
                    </Link>
                    {" · "}
                    <Link href={`/ads/${c.id}/search-terms${q}`} className="underline underline-offset-2">
                      Search terms
                    </Link>
                    {" · "}
                    <Link href={`/ads/${c.id}/keywords${q}`} className="underline underline-offset-2">
                      Keywords
                    </Link>
                  </td>
                </tr>
              ))}
              {clients.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                    No active PPC client has a linked Google Ads account.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
