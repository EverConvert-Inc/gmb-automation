"use client";

import { ChevronDown } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

// Window selector for the reconciliation report. Writes ?days to the URL so the
// server component refetches. Styled-select technique (see AdminSelect): native
// <select> with the browser arrow removed and a ChevronDown centred over it.
export function GoogleAdsReconciliationFilters({ days }: { days: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function set(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "7") params.delete("days");
    else params.set("days", value);
    router.push(`?${params.toString()}`);
  }

  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      Window
      <span className="relative inline-flex">
        <select
          value={String(days)}
          onChange={(e) => set(e.target.value)}
          className="appearance-none rounded-md border bg-background py-1 pl-2.5 pr-7 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="7">Last 7 days</option>
          <option value="14">Last 14 days</option>
          <option value="30">Last 30 days</option>
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
        />
      </span>
    </label>
  );
}
