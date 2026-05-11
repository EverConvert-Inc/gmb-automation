import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeltaPill, MiniBars } from "@/components/charts";
import type { ReviewInsights } from "@/lib/queries";

function formatMonthLabel(monthStart: string): string {
  // monthStart is "YYYY-MM-DD" (always day=01). Render as e.g. "Jan".
  const [y, m] = monthStart.split("-");
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleString(undefined, { month: "short" });
}

function freshnessTone(days: number | null): string {
  if (days === null) return "text-muted-foreground";
  if (days <= 14) return "text-green-700";
  if (days <= 45) return "text-amber-700";
  return "text-red-700";
}

export function ReviewInsightsCard({ data }: { data: ReviewInsights }) {
  const totals = data.monthlyBuckets.map((b) => b.count);
  const labels = data.monthlyBuckets.map((b) => formatMonthLabel(b.monthStart));
  const sumLast12 = totals.reduce((a, b) => a + b, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Review insights
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            label="Days since last review"
            value={
              data.daysSinceLastReview === null
                ? "—"
                : data.daysSinceLastReview === 0
                  ? "today"
                  : String(data.daysSinceLastReview)
            }
            valueClassName={freshnessTone(data.daysSinceLastReview)}
            sub={
              data.lastReviewAt
                ? new Date(data.lastReviewAt).toLocaleDateString()
                : "No reviews yet"
            }
          />
          <Kpi
            label="Last 30 days"
            value={String(data.last30)}
            delta={<DeltaPill current={data.last30} prior={data.prior30} />}
          />
          <Kpi
            label="Last 60 days"
            value={String(data.last60)}
            delta={<DeltaPill current={data.last60} prior={data.prior60} />}
          />
          <Kpi
            label="Last 90 days"
            value={String(data.last90)}
            delta={<DeltaPill current={data.last90} prior={data.prior90} />}
          />
        </div>

        <div className="mt-5 flex items-end justify-between gap-4 border-t pt-4">
          <div>
            <div className="text-xs uppercase text-muted-foreground">
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
              className="text-foreground"
            />
            <div className="mt-1 grid grid-flow-col text-[10px] uppercase tracking-wide text-muted-foreground" style={{ gridTemplateColumns: `repeat(${labels.length}, 1fr)`, width: 260 }}>
              {labels.map((l, i) => (
                <span key={i} className="text-center">{l[0]}</span>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Kpi({
  label,
  value,
  sub,
  delta,
  valueClassName,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-md border bg-muted/10 p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${valueClassName ?? ""}`}>
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {delta ?? sub ?? " "}
      </div>
    </div>
  );
}
