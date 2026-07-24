import type { Metadata } from "next";
import { Building2, Megaphone, PhoneCall } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PpcDateRangeFilter } from "@/components/ppc-date-range-filter";
import { CallQualityGranularityToggle } from "@/components/call-quality-granularity-toggle";
import { CallQualityChannelSection } from "@/components/call-quality-channel-section";
import {
  getCallQualityReport,
  type CallQualityGranularity,
} from "@/lib/queries-call-quality";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Call Quality",
};

// Same rationale as /ppc and /lsa: syncs only pull yesterday's data, so
// "to" defaults to yesterday rather than today.
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

export default async function CallQualityPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; granularity?: string }>;
}) {
  const { from: fromParam, to: toParam, granularity: granularityParam } =
    await searchParams;
  const from = fromParam || firstOfMonthIso();
  const to = toParam || yesterdayIso();
  const granularity: CallQualityGranularity =
    granularityParam === "week" ? "week" : "day";

  const report = await getCallQualityReport({ from, to, granularity });

  const rowsByChannel = {
    PPC: report.rows.filter((r) => r.channel === "PPC"),
    LSA: report.rows.filter((r) => r.channel === "LSA"),
    GMB: report.rows.filter((r) => r.channel === "GMB"),
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Cross-channel
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight">
            Call Quality
          </h1>
        </div>
      </header>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <PpcDateRangeFilter from={from} to={to} />
          <CallQualityGranularityToggle value={granularity} />
        </CardContent>
      </Card>

      <CallQualityChannelSection
        channel="PPC"
        icon={<Megaphone className="h-4 w-4" />}
        totals={report.summary.PPC}
        rows={rowsByChannel.PPC}
        allLabels={report.allLabels}
        granularity={granularity}
      />

      <CallQualityChannelSection
        channel="LSA"
        icon={<PhoneCall className="h-4 w-4" />}
        totals={report.summary.LSA}
        rows={rowsByChannel.LSA}
        allLabels={report.allLabels}
        granularity={granularity}
      />

      <CallQualityChannelSection
        channel="GMB"
        icon={<Building2 className="h-4 w-4" />}
        totals={report.summary.GMB}
        rows={rowsByChannel.GMB}
        allLabels={report.allLabels}
        granularity={granularity}
      />
    </div>
  );
}
