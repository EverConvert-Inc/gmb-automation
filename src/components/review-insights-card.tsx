import { MessageSquareText, Star, TrendingUp } from "lucide-react";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { SectionCard } from "@/components/ui/section-card";
import { StatTile } from "@/components/ui/stat-tile";
import { DeltaPill, MiniBars } from "@/components/charts";
import { METRIC_DESCRIPTIONS } from "@/lib/metric-descriptions";
import type { ReviewInsights } from "@/lib/queries";

function formatMonthLabel(monthStart: string): string {
  // monthStart is "YYYY-MM-DD" (always day=01). Render as e.g. "Jan".
  const [y, m] = monthStart.split("-");
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleString(undefined, { month: "short" });
}

export function ReviewInsightsCard({ data }: { data: ReviewInsights }) {
  const totals = data.monthlyBuckets.map((b) => b.count);
  const labels = data.monthlyBuckets.map((b) => formatMonthLabel(b.monthStart));
  const sumLast12 = totals.reduce((a, b) => a + b, 0);
  // Side-by-side velocity tiles + 12-month sparkbars. "Days since last
  // review" lives in the hero snapshot above, so it's not duplicated here.
  return (
    <SectionCard
      icon={<Star className="h-4 w-4" />}
      title="Review velocity"
      eyebrow="Reputation"
    >
      <div className="grid gap-4 lg:grid-cols-[auto_1fr] lg:items-center">
        <div className="grid grid-cols-2 gap-3 lg:w-[18rem]">
          <StatTile
            label={
              <span className="inline-flex items-center gap-1">
                Last 7 days
                <InfoTooltip>{METRIC_DESCRIPTIONS.reviewsLast7}</InfoTooltip>
              </span>
            }
            value={String(data.last7)}
            sublabel={<DeltaPill current={data.last7} prior={data.prior7} />}
            icon={<MessageSquareText className="h-4 w-4" />}
            tone="brand"
          />
          <StatTile
            label={
              <span className="inline-flex items-center gap-1">
                Last 30 days
                <InfoTooltip>{METRIC_DESCRIPTIONS.reviewsLast30}</InfoTooltip>
              </span>
            }
            value={String(data.last30)}
            sublabel={<DeltaPill current={data.last30} prior={data.prior30} />}
            icon={<TrendingUp className="h-4 w-4" />}
            tone="brand"
          />
        </div>

        <div className="surface-elevated rounded-lg p-4 ring-1 ring-border">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Reviews per month
            </div>
            <div className="text-[10px] text-muted-foreground">
              Last 12 months · {sumLast12} review
              {sumLast12 === 1 ? "" : "s"}
            </div>
          </div>
          <MiniBars
            values={totals}
            labels={labels}
            width={400}
            height={56}
            className="mt-2 w-full text-brand"
          />
          <div
            className="mt-1 grid grid-flow-col text-[10px] uppercase tracking-wide text-muted-foreground"
            style={{ gridTemplateColumns: `repeat(${labels.length}, 1fr)` }}
          >
            {labels.map((l, i) => (
              <span key={i} className="text-center">
                {l[0]}
              </span>
            ))}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
