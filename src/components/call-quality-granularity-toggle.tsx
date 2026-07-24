"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { CallQualityGranularity } from "@/lib/queries-call-quality";

const OPTIONS: Array<{ key: CallQualityGranularity; label: string }> = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
];

export function CallQualityGranularityToggle({
  value,
}: {
  value: CallQualityGranularity;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setGranularity(next: CallQualityGranularity) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("granularity", next);
    router.push(`?${params.toString()}`);
  }

  return (
    <div className="inline-flex items-center gap-1 text-xs">
      {OPTIONS.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => setGranularity(opt.key)}
          className={
            value === opt.key
              ? "rounded-full border border-brand bg-brand/10 px-2.5 py-1 font-medium text-foreground"
              : "rounded-full border border-border bg-background px-2.5 py-1 text-muted-foreground hover:border-foreground/40 hover:text-foreground"
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
