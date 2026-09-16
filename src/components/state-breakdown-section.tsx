"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { STATE_NAMES } from "@/lib/report-grouping";

// Shared collapsible shell for the per-state sections on /ppc and /lsa —
// each report supplies its own KPI strip values and nests its own
// (unchanged) per-client table as children. A code with no entry in
// STATE_NAMES is the "Unassigned" bucket — rendered with no parenthetical
// code, everything else identical.
export function StateBreakdownSection({
  state,
  kpis,
  defaultOpen,
  children,
}: {
  state: string;
  kpis: Array<{ label: string; value: string }>;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const fullName = (STATE_NAMES as Record<string, string>)[state];

  return (
    <div className="rounded-md border bg-background">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-left hover:bg-muted/30"
      >
        <span className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center text-muted-foreground">
          {open ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </span>
        <span className="font-semibold">
          {fullName ?? state}
          {fullName && (
            <span className="ml-1 font-normal text-muted-foreground">
              ({state})
            </span>
          )}
        </span>
        <span className="ml-auto flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {kpis.map((k) => (
            <span key={k.label} className="whitespace-nowrap">
              <span className="uppercase tracking-wide text-muted-foreground">
                {k.label}
              </span>{" "}
              <span className="font-medium tabular-nums">{k.value}</span>
            </span>
          ))}
        </span>
      </button>
      {open && <div className="border-t p-3">{children}</div>}
    </div>
  );
}
