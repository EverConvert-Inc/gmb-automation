import Link from "next/link";
import type { Metadata } from "next";
import {
  BadgeCheck,
  CircleDollarSign,
  Megaphone,
  MousePointerClick,
  PhoneCall,
  Settings as SettingsIcon,
} from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionCard } from "@/components/ui/section-card";
import { StatTile } from "@/components/ui/stat-tile";
import { DeltaPill } from "@/components/charts";
import { PpcDateRangeFilter } from "@/components/ppc-date-range-filter";
import { PpcReportTable } from "@/components/ppc-report-table";
import { StateBreakdownSection } from "@/components/state-breakdown-section";
import { EmailPpcReportButton } from "@/components/email-ppc-report-button";
import { SyncPpcNowButton } from "@/components/sync-ppc-now-button";
import { getPpcReport, listPpcClients, type PpcReportRow } from "@/lib/queries";
import { pickDefaultExpandedState } from "@/lib/report-grouping";
import { yesterdayIsoEastern, firstOfMonthIsoEastern } from "@/lib/date-utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "PPC report",
};

const NUMBER_FMT = new Intl.NumberFormat();
function fmtNumber(n: number): string {
  return NUMBER_FMT.format(n);
}

function fmtUsdFromMicros(micros: bigint): string {
  const dollars = Number(micros / 10_000n) / 100;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(dollars);
}

function fmtUsdFromDollars(dollars: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(dollars);
}

export default async function PpcReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { from: fromParam, to: toParam } = await searchParams;
  // "To" defaults to yesterday rather than today because the daily PPC
  // sync only pulls yesterday's metrics — today is always empty until the
  // next morning's cron. Using today as the end of the window causes the
  // current period to be one day shorter than the (same-length) prior
  // period, which biases every KPI delta more negative than reality.
  const from = fromParam || firstOfMonthIsoEastern();
  const to = toParam || yesterdayIsoEastern();

  const [report, ppcClients] = await Promise.all([
    getPpcReport({ from, to }),
    listPpcClients(),
  ]);

  const noClientsYet = ppcClients.length === 0;
  const costDollars = Number(report.kpis.costMicros / 10_000n) / 100;
  const costDollarsPrior = Number(report.kpisPrior.costMicros / 10_000n) / 100;

  // Campaign rows grouped by client up front so each state section only
  // has to flatMap its own clients' campaigns, not filter the whole list.
  const rowsByClientId = new Map<string, PpcReportRow[]>();
  for (const r of report.rows) {
    const list = rowsByClientId.get(r.ppcClientId);
    if (list) list.push(r);
    else rowsByClientId.set(r.ppcClientId, [r]);
  }
  const defaultExpandedState = pickDefaultExpandedState(report.stateGroups, (r) => r.signedCases);

  if (noClientsYet) {
    return (
      <div className="space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Paid Search
            </div>
            <h1 className="font-display text-3xl font-bold tracking-tight">
              PPC report
            </h1>
          </div>
        </header>
        <Card className="surface-brand-tint">
          <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
            <div className="rounded-full bg-brand/10 p-4 ring-1 ring-brand/20">
              <Megaphone className="h-7 w-7 text-brand" />
            </div>
            <div className="max-w-md space-y-1.5">
              <p className="text-sm font-semibold">No PPC clients yet</p>
              <p className="text-xs text-muted-foreground">
                Add your first PPC client to start tracking Google Ads
                campaigns and CallRail signed cases. Each client connects to
                Google Ads via OAuth and to CallRail by selecting a company.
              </p>
            </div>
            <Link
              href="/ppc/clients/new"
              className={buttonClasses()}
            >
              Add your first PPC client
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Paid Search
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight">
            PPC report
          </h1>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <SyncPpcNowButton from={from} to={to} />
          <EmailPpcReportButton from={from} to={to} />
          <Link
            href="/ppc/clients"
            className={buttonClasses("outline")}
          >
            <SettingsIcon className="mr-2 h-4 w-4" /> Manage PPC clients
          </Link>
        </div>
      </header>

      <Card>
        <CardContent className="p-4">
          <PpcDateRangeFilter from={from} to={to} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile
          label="Clicks"
          value={new Intl.NumberFormat().format(report.kpis.clicks)}
          sublabel={
            <DeltaPill
              current={report.kpis.clicks}
              prior={report.kpisPrior.clicks}
            />
          }
          icon={<MousePointerClick className="h-4 w-4" />}
          tone="brand"
        />
        <StatTile
          label="Signed"
          value={new Intl.NumberFormat().format(report.kpis.signedCases)}
          sublabel={
            <DeltaPill
              current={report.kpis.signedCases}
              prior={report.kpisPrior.signedCases}
            />
          }
          icon={<BadgeCheck className="h-4 w-4" />}
          tone="brand"
        />
        <StatTile
          label="Phone calls"
          value={new Intl.NumberFormat().format(report.kpis.phoneCalls)}
          sublabel={
            <DeltaPill
              current={report.kpis.phoneCalls}
              prior={report.kpisPrior.phoneCalls}
            />
          }
          icon={<PhoneCall className="h-4 w-4" />}
          tone="brand"
        />
        <StatTile
          label="Cost"
          value={fmtUsdFromMicros(report.kpis.costMicros)}
          sublabel={
            <DeltaPill
              current={Math.round(costDollars)}
              prior={Math.round(costDollarsPrior)}
              invert
            />
          }
          icon={<CircleDollarSign className="h-4 w-4" />}
        />
      </div>

      <SectionCard
        icon={<Megaphone className="h-4 w-4" />}
        title="State breakdown"
        eyebrow="Per-client breakdown"
      >
        <div className="space-y-3">
          {report.stateGroups.map((group) => (
            <StateBreakdownSection
              key={group.state}
              state={group.state}
              defaultOpen={group.state === defaultExpandedState}
              kpis={[
                { label: "Clicks", value: fmtNumber(group.rollup.clicks) },
                { label: "Signed", value: fmtNumber(group.rollup.signedCases) },
                { label: "Phone calls", value: fmtNumber(group.rollup.phoneCalls) },
                { label: "Cost", value: fmtUsdFromMicros(group.rollup.costMicros) },
                {
                  label: "Cost/signed",
                  value:
                    group.rollup.costPerSignedCase != null
                      ? fmtUsdFromDollars(group.rollup.costPerSignedCase)
                      : "—",
                },
              ]}
            >
              <PpcReportTable
                rows={group.clients.flatMap((c) => rowsByClientId.get(c.ppcClientId) ?? [])}
                clientTotals={group.clients}
              />
            </StateBreakdownSection>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
