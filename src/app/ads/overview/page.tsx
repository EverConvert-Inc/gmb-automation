import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ComboBarLine } from "@/components/charts";
import { PpcDateRangeFilter } from "@/components/ppc-date-range-filter";
import { GoogleAdsOverviewFilters } from "@/components/google-ads-overview-filters";
import { getGoogleAdsOverview } from "@/lib/queries-google-ads-overview";
import { firstOfMonthIsoEastern, yesterdayIsoEastern } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Google Ads — Overview" };

const money0 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money2 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = (n: number) => Math.round(n).toLocaleString("en-US");
const conv1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString("en-US");
const pct2 = (r: number | null) => (r === null ? "—" : `${(r * 100).toFixed(2)}%`);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}

const TH = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground";
const THR = "px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground";
const TD = "px-3 py-2";
const TDR = "px-3 py-2 text-right tabular-nums";

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export default async function GoogleAdsOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const from = one(sp.from) ?? firstOfMonthIsoEastern();
  let to = one(sp.to) ?? yesterdayIsoEastern();
  if (to < from) to = from;
  const account = one(sp.account) ?? "all";
  const statusRaw = one(sp.status) ?? "enabled";
  const status = (["enabled", "paused", "all"].includes(statusRaw) ? statusRaw : "enabled") as
    | "enabled"
    | "paused"
    | "all";

  const data = await getGoogleAdsOverview({
    range: { from, to },
    clientId: account === "all" ? null : account,
    status,
  });

  const { kpis } = data;
  const tickEvery = Math.max(1, Math.ceil(data.daily.length / 12));
  const points = data.daily.map((p, i) => ({
    label: shortDay(p.date),
    tick: i % tickEvery === 0 || i === data.daily.length - 1 ? shortDay(p.date) : undefined,
    cost: p.cost,
    costPerConv: p.costPerConv,
  }));

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Google Ads</div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Overview</h1>
        </div>
        <div className="text-sm text-muted-foreground">
          {shortDay(from)} – {shortDay(to)}
        </div>
      </header>

      <Card>
        <CardContent className="space-y-3 p-4">
          <PpcDateRangeFilter from={from} to={to} />
          <div className="border-t pt-3">
            <GoogleAdsOverviewFilters accounts={data.accounts} account={account} status={status} />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-6">
        <Kpi label="Total spend" value={money0(kpis.spend)} />
        <Kpi label="Impressions" value={int(kpis.impressions)} />
        <Kpi label="Clicks" value={int(kpis.clicks)} />
        <Kpi label="CTR" value={pct2(kpis.ctr)} />
        <Kpi label="Conversions" value={conv1(kpis.conversions)} />
        <Kpi label="Cost / conv." value={kpis.costPerConv === null ? "—" : money2(kpis.costPerConv)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daily Cost &amp; Cost per Conversion</CardTitle>
          <p className="text-xs text-muted-foreground">Bars show daily cost; the line shows cost per conversion over time.</p>
        </CardHeader>
        <CardContent>
          <ComboBarLine
            points={points}
            formatCost={money0}
            formatCpc={(v) => money0(v)}
            ariaLabel="Daily cost as bars with cost per conversion as a line"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Campaigns</CardTitle>
            <p className="text-xs text-muted-foreground">
              {data.campaigns.length} of {data.campaignTotal} campaigns
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr>
                  <th className={cn(TH, "pl-4")}>Account</th>
                  <th className={TH}>Campaign</th>
                  <th className={TH}>Status</th>
                  <th className={THR}>Impr.</th>
                  <th className={THR}>Clicks</th>
                  <th className={THR}>CTR</th>
                  <th className={THR}>CPC</th>
                  <th className={THR}>Cost</th>
                  <th className={THR}>Conv.</th>
                  <th className={cn(THR, "pr-4")}>Cost / conv.</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.campaigns.map((c) => (
                  <tr key={c.campaignId} className="hover:bg-muted/40">
                    <td className={cn(TD, "pl-4 text-muted-foreground")}>{c.accountName}</td>
                    <td className={TD}>{c.name}</td>
                    <td className={TD}>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                          c.status === "ENABLED"
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {c.status ?? "—"}
                      </span>
                    </td>
                    <td className={TDR}>{int(c.impressions)}</td>
                    <td className={TDR}>{int(c.clicks)}</td>
                    <td className={TDR}>{pct2(c.ctr)}</td>
                    <td className={TDR}>{c.cpc === null ? "—" : money2(c.cpc)}</td>
                    <td className={TDR}>{money0(c.cost)}</td>
                    <td className={TDR}>{conv1(c.conversions)}</td>
                    <td className={cn(TDR, "pr-4")}>{c.costPerConv === null ? "—" : money2(c.costPerConv)}</td>
                  </tr>
                ))}
                {data.campaigns.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No campaigns match this filter in the selected range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Covers every campaign type, Performance Max included. ROAS, campaign type, and expandable ad
        groups &amp; ads are coming as the data layer lands.{" "}
        <Link href="/ads" className="underline hover:text-foreground">
          Account health →
        </Link>
      </p>
    </div>
  );
}
