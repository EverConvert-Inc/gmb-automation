import { StackedBars, type StackedSeries } from "@/components/charts";
import { UNMAPPED_KEY, type RedditReport } from "@/lib/queries-reddit";

// Categorical slots in a fixed order, validated (light on the card surface
// #f6f7f9, dark on #0f0f0f) for colour-blind and normal-vision separation
// between every adjacent pair. Light slots 2-5 sit under 3:1 contrast on
// the card, so the legend totals, hover breakdown and daily table always
// carry the numbers; colour only marks identity.
const SLOT_CLASSES = [
  "bg-[#2a78d6] dark:bg-[#3987e5]",
  "bg-[#eb6834] dark:bg-[#d95926]",
  "bg-[#1baf7a] dark:bg-[#199e70]",
  "bg-[#eda100] dark:bg-[#c98500]",
  "bg-[#e87ba4] dark:bg-[#d55181]",
  "bg-[#008300] dark:bg-[#008300]",
  "bg-[#6250d6] dark:bg-[#9085e9]",
  "bg-[#e34948] dark:bg-[#e66767]",
];
// Neutral for Unmapped and any clients past the eighth — validated against
// every slot above, since whichever client stacks last sits next to it.
const NEUTRAL_CLASS = "bg-[#4a4945] dark:bg-[#b5b4ac]";

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fmtUsd = (dollars: number) => USD.format(dollars);
function fmtTick(dollars: number): string {
  if (dollars >= 1000) return `$${Number((dollars / 1000).toFixed(1))}K`;
  return `$${dollars}`;
}
const microsToDollars = (micros: bigint) => Number(micros) / 1_000_000;

function fmtShortDay(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

export type RedditChartSeries = StackedSeries & { totalMicros: bigint };

// Clients take slots alphabetically, not by spend, so a client keeps its
// colour when the date range changes. Unmapped and clients past the eighth
// fold into one neutral series stacked on top.
export function redditChartSeries(report: RedditReport): {
  dates: string[];
  series: RedditChartSeries[];
} {
  const dates = [...report.dates].reverse(); // chronological, left to right
  const valuesFor = (byDates: Array<Record<string, bigint>>) =>
    dates.map((d) => microsToDollars(byDates.reduce((s, b) => s + (b[d] ?? 0n), 0n)));

  const named = report.clients
    .filter((c) => c.key !== UNMAPPED_KEY)
    .sort((a, b) => a.name.localeCompare(b.name));
  const slotted = named.slice(0, SLOT_CLASSES.length);
  const overflow = named.slice(SLOT_CLASSES.length);
  const unmapped = report.clients.find((c) => c.key === UNMAPPED_KEY);

  const series: RedditChartSeries[] = slotted.map((c, i) => ({
    key: c.key,
    label: c.name,
    colorClass: SLOT_CLASSES[i],
    values: valuesFor([c.byDate]),
    totalMicros: c.totalMicros,
  }));
  const folded = [...overflow, ...(unmapped ? [unmapped] : [])];
  if (folded.length) {
    series.push({
      key: "other",
      label: overflow.length ? (unmapped ? "Other clients + unmapped" : "Other clients") : "Unmapped",
      colorClass: NEUTRAL_CLASS,
      values: valuesFor(folded.map((c) => c.byDate)),
      totalMicros: folded.reduce((s, c) => s + c.totalMicros, 0n),
    });
  }
  return { dates, series };
}

export function RedditDailySpendChart({ report }: { report: RedditReport }) {
  if (report.totalMicros === 0n) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No spend in this range.</p>;
  }
  const { dates, series } = redditChartSeries(report);
  // ~7 date ticks whatever the range length.
  const every = Math.max(1, Math.ceil(dates.length / 7));
  const columns = dates.map((d, i) => ({
    key: d,
    label: new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", {
      timeZone: "UTC",
      weekday: "short",
      month: "short",
      day: "numeric",
    }),
    tick: i % every === 0 ? fmtShortDay(d) : undefined,
  }));

  return (
    <div className="space-y-3">
      {series.length > 1 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-sm ${s.colorClass}`} aria-hidden />
              <span className="text-muted-foreground">{s.label}</span>
              <span className="tabular-nums">{fmtUsd(microsToDollars(s.totalMicros))}</span>
            </li>
          ))}
        </ul>
      )}
      <StackedBars
        columns={columns}
        series={series}
        formatValue={fmtUsd}
        formatTick={fmtTick}
        ariaLabel={`Daily Reddit spend by client, ${fmtShortDay(dates[0])} to ${fmtShortDay(
          dates[dates.length - 1],
        )}, ${fmtUsd(microsToDollars(report.totalMicros))} total. The daily table below has every value.`}
      />
    </div>
  );
}
