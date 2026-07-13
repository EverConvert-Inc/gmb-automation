import Link from "next/link";
import type { Metadata } from "next";
import {
  CalendarCheck,
  CircleDollarSign,
  MessageSquare,
  PhoneCall,
  Settings as SettingsIcon,
} from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionCard } from "@/components/ui/section-card";
import { StatTile } from "@/components/ui/stat-tile";
import { DeltaPill } from "@/components/charts";
import { PpcDateRangeFilter } from "@/components/ppc-date-range-filter";
import { LsaReportTable } from "@/components/lsa-report-table";
import { getLsaReport, listLsaClients } from "@/lib/queries-lsa";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "LSA report",
};

// Same rationale as /ppc: the sync only pulls yesterday's data, so "to"
// defaults to yesterday rather than today (today is always empty until
// the next morning's cron, which would otherwise bias every KPI delta).
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

export default async function LsaReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { from: fromParam, to: toParam } = await searchParams;
  const from = fromParam || firstOfMonthIso();
  const to = toParam || yesterdayIso();

  const [report, lsaClients] = await Promise.all([
    getLsaReport({ from, to }),
    listLsaClients(),
  ]);

  const noClientsYet = lsaClients.length === 0;
  const costDollars = Number(report.kpis.costMicros / 10_000n) / 100;
  const costDollarsPrior = Number(report.kpisPrior.costMicros / 10_000n) / 100;

  if (noClientsYet) {
    return (
      <div className="space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Local Services
            </div>
            <h1 className="font-display text-3xl font-bold tracking-tight">
              LSA report
            </h1>
          </div>
        </header>
        <Card className="surface-brand-tint">
          <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
            <div className="rounded-full bg-brand/10 p-4 ring-1 ring-brand/20">
              <PhoneCall className="h-7 w-7 text-brand" />
            </div>
            <div className="max-w-md space-y-1.5">
              <p className="text-sm font-semibold">No LSA clients yet</p>
              <p className="text-xs text-muted-foreground">
                Add your first LSA client to start tracking Local Services
                Ads leads and CallRail signed cases. Each client connects to
                Google Ads via OAuth and to CallRail by selecting a company.
              </p>
            </div>
            <Link href="/lsa/clients/new" className={buttonClasses()}>
              Add your first LSA client
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
            Local Services
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight">
            LSA report
          </h1>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <Link href="/lsa/clients" className={buttonClasses("outline")}>
            <SettingsIcon className="mr-2 h-4 w-4" /> Manage LSA clients
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
          label="Phone calls"
          value={new Intl.NumberFormat().format(report.kpis.phoneCallCount)}
          sublabel={
            <DeltaPill
              current={report.kpis.phoneCallCount}
              prior={report.kpisPrior.phoneCallCount}
            />
          }
          icon={<PhoneCall className="h-4 w-4" />}
          tone="brand"
        />
        <StatTile
          label="Messages"
          value={new Intl.NumberFormat().format(report.kpis.messageCount)}
          sublabel={
            <DeltaPill
              current={report.kpis.messageCount}
              prior={report.kpisPrior.messageCount}
            />
          }
          icon={<MessageSquare className="h-4 w-4" />}
          tone="brand"
        />
        <StatTile
          label="Bookings"
          value={new Intl.NumberFormat().format(report.kpis.bookingCount)}
          sublabel={
            <DeltaPill
              current={report.kpis.bookingCount}
              prior={report.kpisPrior.bookingCount}
            />
          }
          icon={<CalendarCheck className="h-4 w-4" />}
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
        title="Clients"
        eyebrow="Per-client breakdown"
      >
        <LsaReportTable rows={report.rows} />
      </SectionCard>
    </div>
  );
}
