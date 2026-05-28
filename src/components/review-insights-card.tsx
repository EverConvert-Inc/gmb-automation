import { CalendarClock, MessageSquareText, Star, TrendingUp } from "lucide-react";
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

function freshnessTone(days: number | null): "default" | "amber" | "red" {
  if (days === null) return "default";
  if (days <= 14) return "default";
  if (days <= 45) return "amber";
  return "red";
}

export function ReviewInsightsCard({ data }: { data: ReviewInsights }) {
  const totals = data.monthlyBuckets.map((b) => b.count);
  const labels = data.monthlyBuckets.map((b) => formatMonthLabel(b.monthStart));
  const sumLast12 = totals.reduce((a, b) => a + b, 0);

  return (
    <SectionCard
      icon={<Star className="h-4 w-4" />}
      title="Review insights"
      eyebrow="Reputation"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label={
            <span className="inline-flex items-center gap-1">
              Days since last review
              <InfoTooltip>
                {METRIC_DESCRIPTIONS.daysSinceLastReview}
              </InfoTooltip>
            </span>
          }
          value={
            data.daysSinceLastReview === null
              ? "—"
              : data.daysSinceLastReview === 0
                ? "today"
                : String(data.daysSinceLastReview)
          }
          sublabel={
            data.lastReviewAt
              ? new Date(data.lastReviewAt).toLocaleDateString()
              : "No reviews yet"
          }
          tone={freshnessTone(data.daysSinceLastReview)}
          icon={<CalendarClock className="h-4 w-4" />}
        />
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

      <div className="mt-5 flex items-end justify-between gap-4 border-t border-border/60 pt-4">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Reviews per month
          </div>
          <div className="text-xs text-muted-foreground">
            Last 12 months · {sumLast12} review{sumLast12 === 1 ? "" : "s"}
          </div>
        </div>
        <div className="flex flex-col items-end">
          <MiniBars
            values={totals}
            labels={labels}
            width={260}
            height={42}
            className="text-brand"
          />
          <div
            className="mt-1 grid grid-flow-col text-[10px] uppercase tracking-wide text-muted-foreground"
            style={{
              gridTemplateColumns: `repeat(${labels.length}, 1fr)`,
              width: 260,
            }}
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
