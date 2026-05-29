"use client";

import { useMemo, useRef, useState } from "react";
import type { PpcByDayPoint } from "@/lib/queries";

// Distinct line colors picked by INDEX, not slug hash — guarantees every
// client on the chart gets a unique color regardless of slug collisions
// (the previous hash-based picker was assigning the same orange to multiple
// clients). 10 colors is plenty for the agency's client count.
const STROKE_COLORS = [
  "#22c55e", // green-500
  "#0ea5e9", // sky-500
  "#f59e0b", // amber-500
  "#ec4899", // pink-500
  "#a855f7", // purple-500
  "#14b8a6", // teal-500
  "#f43f5e", // rose-500
  "#6366f1", // indigo-500
  "#84cc16", // lime-500
  "#fb923c", // orange-400
];

type Props = {
  byDay: PpcByDayPoint[];
  from: string;
  to: string;
};

// Phone calls by day, one line per client. SVG-only (no charting lib).
// Hovering anywhere over the chart shows a vertical guideline at the
// nearest date plus a floating tooltip listing every client's value for
// that day. Hovering a legend entry isolates that client's line.
export function PpcPhoneCallsChart({ byDay, from, to }: Props) {
  // Build complete date axis so missing days render as 0 instead of skipping.
  const dates = useMemo(() => {
    const out: string[] = [];
    const start = new Date(from + "T00:00:00Z");
    const end = new Date(to + "T00:00:00Z");
    for (
      let d = new Date(start);
      d.getTime() <= end.getTime();
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }, [from, to]);

  const seriesById = useMemo(() => {
    const m = new Map<string, { name: string; values: number[] }>();
    for (const p of byDay) {
      const cur = m.get(p.ppcClientId) ?? {
        name: p.ppcClientName,
        values: new Array(dates.length).fill(0),
      };
      const idx = dates.indexOf(p.date);
      if (idx >= 0) cur.values[idx] = (cur.values[idx] ?? 0) + p.phoneCalls;
      m.set(p.ppcClientId, cur);
    }
    return m;
  }, [byDay, dates]);

  const series = useMemo(
    () =>
      Array.from(seriesById.entries())
        .map(([id, v]) => ({ id, ...v }))
        // Stable order by name → stable color assignment between renders.
        .sort((a, b) => a.name.localeCompare(b.name)),
    [seriesById],
  );

  // Index-based color map: series[0] → STROKE_COLORS[0], etc.
  const colorByClientId = useMemo(() => {
    const map = new Map<string, string>();
    series.forEach((s, i) =>
      map.set(s.id, STROKE_COLORS[i % STROKE_COLORS.length]),
    );
    return map;
  }, [series]);

  const yMax = useMemo(() => {
    let max = 0;
    for (const s of series) for (const v of s.values) if (v > max) max = v;
    return Math.max(1, max);
  }, [series]);

  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const W = 800;
  const H = 220;
  const PAD = { top: 12, right: 16, bottom: 28, left: 36 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const xStep = dates.length > 1 ? innerW / (dates.length - 1) : 0;

  function pointPath(values: number[]): string {
    return values
      .map((v, i) => {
        const x = PAD.left + i * xStep;
        const y = PAD.top + innerH - (v / yMax) * innerH;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }

  // X-axis tick labels: pick ~6 evenly spaced dates.
  const tickIndexes = useMemo(() => {
    if (dates.length <= 6) return dates.map((_, i) => i);
    const out: number[] = [];
    for (let i = 0; i < 6; i++) {
      out.push(Math.round((i / 5) * (dates.length - 1)));
    }
    return out;
  }, [dates]);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(t * yMax));

  // Translate a pointer event over the wrapper into the nearest date index.
  // We work in viewBox coords by using the wrapper's pixel size as the
  // reference (the SVG fills the wrapper via w-full h-auto), so the ratio
  // applies regardless of CSS scaling.
  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!wrapperRef.current || dates.length === 0) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const xPx = e.clientX - rect.left;
    const leftPx = (PAD.left / W) * rect.width;
    const innerWPx = (innerW / W) * rect.width;
    const ratio = (xPx - leftPx) / innerWPx;
    if (ratio < -0.02 || ratio > 1.02) {
      setHoverIndex(null);
      return;
    }
    const clamped = Math.max(0, Math.min(1, ratio));
    const idx = Math.round(clamped * (dates.length - 1));
    setHoverIndex(idx);
  }

  if (series.length === 0) {
    return (
      <div className="rounded-md border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        No phone-call data for this range yet.
      </div>
    );
  }

  // Tooltip rendered as absolutely-positioned HTML over the wrapper. Left
  // position is expressed in % of wrapper width (matching the SVG's viewBox
  // ratio), then nudged so it doesn't overflow the right edge.
  const tooltipLeftPct =
    hoverIndex !== null
      ? ((PAD.left + hoverIndex * xStep) / W) * 100
      : null;
  const flipLeft = tooltipLeftPct !== null && tooltipLeftPct > 65;
  const hoverDate = hoverIndex !== null ? dates[hoverIndex] : null;
  // Sort tooltip rows by value desc so the visually-prominent line tops
  // the list. Zero-value series fall to the bottom but stay visible.
  const tooltipRows =
    hoverIndex !== null
      ? series
          .map((s) => ({ ...s, value: s.values[hoverIndex] ?? 0 }))
          .sort((a, b) => b.value - a.value)
      : [];

  return (
    <div className="space-y-3">
      <div
        ref={wrapperRef}
        className="relative overflow-hidden"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full min-w-[600px] text-muted-foreground"
          style={{ pointerEvents: "none" }}
        >
          {/* Y gridlines + tick labels */}
          {yTicks.map((t, i) => {
            const y = PAD.top + innerH - (t / yMax) * innerH;
            return (
              <g key={i}>
                <line
                  x1={PAD.left}
                  x2={PAD.left + innerW}
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  strokeOpacity={0.15}
                />
                <text
                  x={PAD.left - 6}
                  y={y + 3}
                  fontSize="10"
                  textAnchor="end"
                  fill="currentColor"
                >
                  {t}
                </text>
              </g>
            );
          })}
          {/* X-axis ticks */}
          {tickIndexes.map((idx) => {
            const x = PAD.left + idx * xStep;
            return (
              <text
                key={idx}
                x={x}
                y={H - 8}
                fontSize="10"
                textAnchor="middle"
                fill="currentColor"
              >
                {dates[idx]?.slice(5)}
              </text>
            );
          })}
          {/* Hover guideline */}
          {hoverIndex !== null && (
            <line
              x1={PAD.left + hoverIndex * xStep}
              x2={PAD.left + hoverIndex * xStep}
              y1={PAD.top}
              y2={PAD.top + innerH}
              stroke="currentColor"
              strokeOpacity={0.35}
              strokeDasharray="3 3"
            />
          )}
          {/* Series */}
          {series.map((s) => {
            const isHi = highlightId === s.id;
            const isDim = highlightId !== null && !isHi;
            return (
              <path
                key={s.id}
                d={pointPath(s.values)}
                fill="none"
                stroke={colorByClientId.get(s.id) ?? "#888"}
                strokeWidth={isHi ? 2.5 : 1.6}
                strokeOpacity={isDim ? 0.25 : 1}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            );
          })}
          {/* Per-series dot at the hovered date */}
          {hoverIndex !== null &&
            series.map((s) => {
              const v = s.values[hoverIndex] ?? 0;
              const x = PAD.left + hoverIndex * xStep;
              const y = PAD.top + innerH - (v / yMax) * innerH;
              return (
                <circle
                  key={s.id}
                  cx={x}
                  cy={y}
                  r={3}
                  fill={colorByClientId.get(s.id) ?? "#888"}
                  stroke="hsl(var(--background))"
                  strokeWidth={1.5}
                />
              );
            })}
        </svg>

        {/* Floating tooltip */}
        {hoverIndex !== null && tooltipLeftPct !== null && hoverDate && (
          <div
            className="pointer-events-none absolute z-10 min-w-[160px] rounded-md border bg-card text-card-foreground shadow-md"
            style={{
              left: `${tooltipLeftPct}%`,
              top: 8,
              transform: flipLeft
                ? "translateX(calc(-100% - 12px))"
                : "translateX(12px)",
            }}
          >
            <div className="border-b px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {hoverDate}
            </div>
            <div className="space-y-0.5 px-2.5 py-1.5 text-xs">
              {tooltipRows.map((s) => (
                <div key={s.id} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
                    style={{
                      backgroundColor: colorByClientId.get(s.id) ?? "#888",
                    }}
                  />
                  <span className="flex-1 truncate">{s.name}</span>
                  <span className="font-medium tabular-nums">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {series.map((s) => (
          <button
            key={s.id}
            type="button"
            onMouseEnter={() => setHighlightId(s.id)}
            onMouseLeave={() => setHighlightId(null)}
            onFocus={() => setHighlightId(s.id)}
            onBlur={() => setHighlightId(null)}
            className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-muted/40"
          >
            <span
              aria-hidden
              className="inline-block h-2 w-3 rounded-sm"
              style={{ backgroundColor: colorByClientId.get(s.id) ?? "#888" }}
            />
            {s.name}
          </button>
        ))}
      </div>
    </div>
  );
}
