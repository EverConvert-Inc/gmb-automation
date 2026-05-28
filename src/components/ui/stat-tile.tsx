import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "default" | "brand" | "amber" | "red" | "muted";

const toneRing: Record<Tone, string> = {
  default: "ring-1 ring-border",
  brand: "ring-1 ring-brand/30",
  amber: "ring-1 ring-amber-500/30",
  red: "ring-1 ring-red-500/30",
  muted: "ring-1 ring-border",
};

const toneAccent: Record<Tone, string> = {
  default: "bg-muted text-muted-foreground",
  brand: "bg-brand/15 text-brand",
  amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  red: "bg-red-500/15 text-red-600 dark:text-red-400",
  muted: "bg-muted text-muted-foreground",
};

const toneValue: Record<Tone, string> = {
  default: "text-foreground",
  brand: "text-foreground",
  amber: "text-amber-600 dark:text-amber-400",
  red: "text-red-600 dark:text-red-400",
  muted: "text-muted-foreground",
};

// Compact dashboard KPI tile: small uppercase label + corner accent + a
// big numerical headline. Optional `sublabel` for short context (e.g.
// "≤3★ unreplied") and `icon` for a small lucide glyph in the accent
// chip.
export function StatTile({
  label,
  value,
  sublabel,
  tone = "default",
  icon,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sublabel?: React.ReactNode;
  tone?: Tone;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "surface-elevated relative overflow-hidden rounded-lg p-4 shadow-card",
        toneRing[tone],
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          <div
            className={cn(
              "mt-1 text-2xl font-semibold leading-tight tabular-nums",
              toneValue[tone],
            )}
          >
            {value}
          </div>
          {sublabel && (
            <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
              {sublabel}
            </div>
          )}
        </div>
        {icon && (
          <div
            className={cn(
              "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md",
              toneAccent[tone],
            )}
          >
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
