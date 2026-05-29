"use client";

import { useMemo, useState } from "react";
import type { PpcByDayPoint } from "@/lib/queries";

// Deterministic stroke color per client id. Tailwind-bg utilities don't help
// here since SVG strokes take a literal color.
const STROKE_COLORS = [
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#0ea5e9",
  "#14b8a6",
  "#8b5cf6",
  "#6366f1",
  "#fb923c",
  "#d946ef",
  "#84cc16",
];
function strokeFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return STROKE_COLORS[hash % STROKE_COLORS.length];
}

type Props = {
  byDay: PpcByDayPoint[];
  from: string;
  to: string;
};

// Phone calls by day, one line per client. SVG-only (no charting lib).
// Hovering a legend entry isolates that client's line.
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
    () => Array.from(seriesById.entries()).map(([id, v]) => ({ id, ...v })),
    [seriesById],
  );

  const yMax = useMemo(() => {
    let max = 0;
    for (const s of series) for (const v of s.values) if (v > max) max = v;
    return Math.max(1, max);
  }, [series]);

  const [highlightId, setHighlightId] = useState<string | null>(null);

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

  if (series.length === 0) {
    return (
      <div className="rounded-md border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        No phone-call data for this range yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full min-w-[600px] text-muted-foreground"
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
          {/* Series */}
          {series.map((s) => {
            const isHi = highlightId === s.id;
            const isDim = highlightId !== null && !isHi;
            return (
              <path
                key={s.id}
                d={pointPath(s.values)}
                fill="none"
                stroke={strokeFor(s.id)}
                strokeWidth={isHi ? 2.5 : 1.6}
                strokeOpacity={isDim ? 0.25 : 1}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            );
          })}
        </svg>
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
              style={{ backgroundColor: strokeFor(s.id) }}
            />
            {s.name}
          </button>
        ))}
      </div>
    </div>
  );
}
