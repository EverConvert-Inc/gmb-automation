import { ArrowDown, ArrowUp, Minus } from "lucide-react";

export function Sparkline({
  data,
  height = 32,
  className = "",
}: {
  data: number[];
  height?: number;
  className?: string;
}) {
  if (data.length === 0 || data.every((v) => v === 0)) {
    return (
      <div
        className={`flex items-center justify-center text-xs text-muted-foreground ${className}`}
        style={{ height }}
      >
        no recent activity
      </div>
    );
  }

  const width = 120;
  const max = Math.max(...data);
  const min = 0;
  const range = max - min || 1;
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;

  const points = data
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const areaPoints = `0,${height} ${points} ${(data.length - 1) * stepX},${height}`;

  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      width="100%"
      height={height}
      role="img"
      aria-label={`Trend: ${data.join(", ")}`}
    >
      <polygon points={areaPoints} className="fill-emerald-500/15" />
      <polyline
        points={points}
        className="stroke-emerald-500"
        fill="none"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function VelocityDelta({
  this30,
  prior30,
  showArrow = true,
}: {
  this30: number;
  prior30: number;
  showArrow?: boolean;
}) {
  const delta = this30 - prior30;
  if (this30 === 0 && prior30 === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-muted-foreground">
        {showArrow && <Minus className="h-3 w-3" />}
        flat
      </span>
    );
  }
  const positive = delta > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 ${positive ? "text-emerald-600" : "text-red-600"}`}
    >
      {showArrow && (positive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      {Math.abs(delta)}
    </span>
  );
}
