import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

// Small, no-dep tooltip. The trigger is a focusable button so the tooltip is
// reachable by keyboard (Tab) as well as mouse hover. The bubble uses CSS
// visibility transitions, so it works inside server components too.
export function InfoTooltip({
  children,
  side = "top",
  className,
  "aria-label": ariaLabel = "More info",
}: {
  children: React.ReactNode;
  side?: "top" | "bottom";
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <span className={cn("group relative inline-flex", className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-muted-foreground/70 hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none invisible absolute left-1/2 z-20 w-56 -translate-x-1/2 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] font-normal normal-case leading-snug text-slate-50 opacity-0 shadow-lg transition-opacity duration-100 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100",
          side === "top" ? "bottom-full mb-2" : "top-full mt-2",
        )}
      >
        {children}
      </span>
    </span>
  );
}
