import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Select } from "@/components/ui/form";
import { cn } from "@/lib/utils";

/**
 * Every select in the admin. The shared Select (same height, border, radius
 * and focus ring as Input) with the browser's arrow replaced by a chevron
 * 12px from the right edge, vertically centred, and right padding so the
 * label never runs under it. Still a native select element: keyboard and
 * the dropdown on open are the browser's own.
 */
export const AdminSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <div className="relative w-full">
    <Select ref={ref} className={cn("peer appearance-none pr-9", className)} {...props} />
    <ChevronDown
      aria-hidden
      className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground peer-disabled:opacity-50"
    />
  </div>
));
AdminSelect.displayName = "AdminSelect";
