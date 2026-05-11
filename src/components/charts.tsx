// Lightweight no-dep SVG sparklines for KPI cards. Server-renderable.

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
  const color = neutral
    ? "text-muted-foreground"
    : isGood
      ? "text-green-700 bg-green-50 border-green-200"
      : "text-amber-700 bg-amber-50 border-amber-200";
  const sign = positive ? "+" : "";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-px text-[10px] font-medium ${color}`}
    >
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
  const color = isGood
    ? "text-green-700 bg-green-50 border-green-200"
    : "text-amber-700 bg-amber-50 border-amber-200";
  const sign = delta > 0 ? "+" : "";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-px text-[10px] font-medium ${color}`}
    >
      {sign}
      {delta.toFixed(precision)}
    </span>
  );
}
