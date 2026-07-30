import Link from "next/link";
import type { Metadata } from "next";
import {
  CircleDollarSign,
  Megaphone,
  MousePointerClick,
  PhoneCall,
  Settings as SettingsIcon,
  Target,
} from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionCard } from "@/components/ui/section-card";
import { StatTile } from "@/components/ui/stat-tile";
import { DeltaPill } from "@/components/charts";
import { PpcDateRangeFilter } from "@/components/ppc-date-range-filter";
import { PpcPhoneCallsChart } from "@/components/ppc-phone-calls-chart";
import { PpcReportTable } from "@/components/ppc-report-table";
import { EmailPpcReportButton } from "@/components/email-ppc-report-button";
import { EmailOptimizationAlertButton } from "@/components/email-optimization-alert-button";
import { getPpcReport, listPpcClients } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "PPC report",
};

// "To" defaults to yesterday rather than today because the daily PPC
// sync only pulls yesterday's metrics — today is always empty until the
// next morning's cron. Using today as the end of the window causes the
// current period to be one day shorter than the (same-length) prior
// period, which biases every KPI delta more negative than reality.
function yesterdayIso(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function firstOfMonthIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

function fmtUsdFromMicros(micros: bigint): string {
  const dollars = Number(micros / 10_000n) / 100;
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
  const from = fromParam || firstOfMonthIso();
  const to = toParam || yesterdayIso();

  const [report, ppcClients] = await Promise.all([
    getPpcReport({ from, to }),
    listPpcClients(),
  ]);

  const noClientsYet = ppcClients.length === 0;
  const costDollars = Number(report.kpis.costMicros / 10_000n) / 100;
  const costDollarsPrior = Number(report.kpisPrior.costMicros / 10_000n) / 100;

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
          <EmailPpcReportButton from={from} to={to} />
          <EmailOptimizationAlertButton />
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
          label="Conversions"
          value={
            report.kpis.conversions % 1 === 0
              ? new Intl.NumberFormat().format(report.kpis.conversions)
              : report.kpis.conversions.toFixed(1)
          }
          sublabel={
            <DeltaPill
              current={Math.round(report.kpis.conversions)}
              prior={Math.round(report.kpisPrior.conversions)}
            />
          }
          icon={<Target className="h-4 w-4" />}
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
        icon={<PhoneCall className="h-4 w-4" />}
        title="Phone calls by day"
        eyebrow="Pacing"
      >
        <PpcPhoneCallsChart byDay={report.byDay} from={from} to={to} />
      </SectionCard>

      <SectionCard
        icon={<Megaphone className="h-4 w-4" />}
        title="Campaigns"
        eyebrow="Per-client breakdown"
      >
        <PpcReportTable rows={report.rows} clientTotals={report.clientTotals} />
      </SectionCard>
    </div>
  );
}
