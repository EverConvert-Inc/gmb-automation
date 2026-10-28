// Lightweight no-dep charts: SVG sparklines for KPI cards, plus a
// full-size stacked column chart. Server-renderable.

import { badgeClasses } from "@/components/ui/badge";

export function MiniBars({
  values,
  labels,
  width = 160,
  height = 36,
  className,
}: {
  values: number[];
  labels?: string[];
  width?: number;
  height?: number;
  className?: string;
}) {
  if (values.length === 0) return null;
  const max = Math.max(...values, 1);
  const barWidth = width / values.length;
  const gap = Math.max(1, Math.floor(barWidth * 0.18));
  const innerWidth = barWidth - gap;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      aria-hidden="true"
    >
      {values.map((v, i) => {
        const barH = max === 0 ? 0 : (v / max) * (height - 2);
        const x = i * barWidth + gap / 2;
        const y = height - barH;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={innerWidth}
            height={barH}
            rx={1}
            ry={1}
            fill="currentColor"
            opacity={v === 0 ? 0.25 : 0.8}
          >
            {labels?.[i] && <title>{`${labels[i]}: ${v}`}</title>}
          </rect>
        );
      })}
    </svg>
  );
}

export type StackedSeries = {
  key: string;
  label: string;
  // Tailwind background classes for light and dark, e.g.
  // "bg-[#2a78d6] dark:bg-[#3987e5]". Written out literally by the caller
  // so Tailwind's scanner sees them.
  colorClass: string;
  values: number[]; // one per column, same order as `columns`
};

function niceStep(rough: number): number {
  if (rough <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const n = rough / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

// Full-size stacked column chart, server-rendered with no chart library.
// Plain HTML boxes rather than a scaled SVG viewBox so the geometry stays
// exact at any width: bars capped at 24px, a 2px surface gap between
// stacked segments, 4px rounded tops, square at the baseline. Hovering a
// column (the whole column is the hit target) shows its breakdown; the
// chart is aria-labelled and callers keep a table view alongside it.
export function StackedBars({
  columns,
  series,
  formatValue,
  formatTick = formatValue,
  height = 180,
  ariaLabel,
}: {
  columns: Array<{ key: string; label: string; tick?: string }>;
  series: StackedSeries[];
  formatValue: (v: number) => string;
  formatTick?: (v: number) => string;
  height?: number;
  ariaLabel: string;
}) {
  const totals = columns.map((_, i) => series.reduce((s, x) => s + (x.values[i] ?? 0), 0));
  const step = niceStep(Math.max(...totals, 0) / 4);
  const top = Math.max(step, Math.ceil(Math.max(...totals, 0) / step) * step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

  return (
    <div role="img" aria-label={ariaLabel} className="flex gap-2">
      {/* y-axis labels */}
      <div className="relative w-10 flex-shrink-0 text-right text-[10px] tabular-nums text-muted-foreground" style={{ height }}>
        {ticks.map((t) => (
          <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: height - (t / top) * height }}>
            {formatTick(t)}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative" style={{ height }}>
          {/* hairline gridlines, recessive */}
          {ticks.map((t) => (
            <div key={t} className="absolute inset-x-0 h-px bg-border" style={{ top: height - (t / top) * height }} />
          ))}
          <div className="absolute inset-0 flex">
            {columns.map((c, i) => {
              const total = totals[i];
              const present = series.filter((s) => (s.values[i] ?? 0) > 0);
              return (
                <div key={c.key} className="group relative flex h-full min-w-0 flex-1 items-end justify-center">
                  <div className="pointer-events-none absolute inset-y-0 inset-x-px rounded-sm bg-foreground/0 group-hover:bg-foreground/[0.04]" />
                  {total > 0 && (
                    <div
                      className="relative flex w-[70%] max-w-[24px] flex-col-reverse gap-[2px] overflow-hidden rounded-t-[4px]"
                      style={{ height: (total / top) * height }}
                    >
                      {present.map((s) => (
                        <div
                          key={s.key}
                          className={`min-h-0 ${s.colorClass}`}
                          style={{ flex: `${s.values[i]} 1 0px` }}
                        />
                      ))}
                    </div>
                  )}
                  <div
                    className={`pointer-events-none absolute top-0 z-10 hidden w-max min-w-[11rem] max-w-[16rem] rounded-md border bg-background p-2 text-xs text-foreground shadow-md group-hover:block ${
                      i < columns.length / 2 ? "left-0" : "right-0"
                    }`}
                  >
                    <div className="mb-1 flex justify-between gap-3 font-medium">
                      <span>{c.label}</span>
                      <span className="tabular-nums">{formatValue(total)}</span>
                    </div>
                    {[...present].reverse().map((s) => (
                      <div key={s.key} className="flex items-center justify-between gap-3 text-muted-foreground">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className={`h-2 w-2 flex-shrink-0 rounded-sm ${s.colorClass}`} />
                          <span className="truncate">{s.label}</span>
                        </span>
                        <span className="tabular-nums text-foreground">{formatValue(s.values[i])}</span>
                      </div>
                    ))}
                    {present.length === 0 && <div className="text-muted-foreground">No spend</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {/* x-axis labels */}
        <div className="mt-1 flex h-4 text-[10px] text-muted-foreground">
          {columns.map((c, i) => (
            <span key={c.key} className="relative min-w-0 flex-1">
              {c.tick && (
                // Centered under its column; the outermost labels anchor
                // inward so they can't spill past the plot.
                <span
                  className={`absolute top-0 whitespace-nowrap ${
                    i === 0 ? "left-0" : i === columns.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2"
                  }`}
                >
                  {c.tick}
                </span>
              )}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SparkLine({
  values,
  width = 160,
  height = 36,
  className,
}: {
  values: Array<number | null>;
  width?: number;
  height?: number;
  className?: string;
}) {
  const numeric = values.filter((v): v is number => v !== null);
  if (numeric.length < 2) return null;
  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  const range = max - min || 1;
  const step = width / (values.length - 1);

  let d = "";
  let pen: "M" | "L" = "M";
  values.forEach((v, i) => {
    if (v === null) {
      pen = "M";
      return;
    }
    const x = i * step;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    d += `${pen}${x.toFixed(1)} ${y.toFixed(1)} `;
    pen = "L";
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      aria-hidden="true"
    >
      <path
        d={d.trim()}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DeltaPill({
  current,
  prior,
  unit = "",
  invert = false,
}: {
  current: number;
  prior: number;
  unit?: string;
  invert?: boolean;
}) {
  if (prior === 0 && current === 0) {
    return <span className="text-xs text-muted-foreground">no change</span>;
  }
  const delta = current - prior;
  const positive = delta > 0;
  const neutral = delta === 0;
  const isGood = neutral ? false : invert ? !positive : positive;
  // Neutral keeps its plain muted look; good/bad use the shared badge colours.
  const className = neutral
    ? "inline-flex items-center rounded-full border border-transparent px-1.5 py-px text-[10px] font-medium text-muted-foreground"
    : badgeClasses(isGood ? "green" : "amber", "sm", "rounded-full border border-transparent");
  const sign = positive ? "+" : "";
  return (
    <span className={className}>
      {sign}
      {Math.abs(delta) < 10 ? delta.toFixed(1) : Math.round(delta)}
      {unit} vs prior
    </span>
  );
}

export function NumericDeltaPill({
  current,
  prior,
  precision = 1,
  invert = false,
}: {
  current: number | null;
  prior: number | null;
  precision?: number;
  invert?: boolean;
}) {
  if (current === null || prior === null) {
    return <span className="text-[10px] text-muted-foreground">no prior</span>;
  }
  const delta = current - prior;
  if (delta === 0) {
    return <span className="text-[10px] text-muted-foreground">no change</span>;
  }
  const isGood = invert ? delta < 0 : delta > 0;
  const sign = delta > 0 ? "+" : "";
  return (
    <span className={badgeClasses(isGood ? "green" : "amber", "sm", "rounded-full border border-transparent")}>
      {sign}
      {delta.toFixed(precision)}
    </span>
  );
}
