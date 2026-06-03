"use client";

import { useEffect, useState } from "react";

type Payload = {
  spentUsd: number | null;
  anchorUsd: number | null;
  anchorDate: string | null;
  state: "ready" | "error";
  sinceIso: string;
  asOfIso: string;
};

// Month-to-date spend against the SEO API (DataForSEO under the hood,
// label is intentionally generic). Fetches once on mount, falls back to
// "—" on error or while we're still seeding the first month's baseline.
export function SeoApiSpendIndicator() {
  const [data, setData] = useState<Payload | null>(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/seo-api-spend", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as Payload;
        if (!cancelled) setData(body);
      } catch {
        if (!cancelled) setErrored(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const ready = !errored && data?.state === "ready" && data.spentUsd !== null;
  const displayValue = ready
    ? new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(data!.spentUsd!)
    : "—";

  // Hover tooltip shows when the month's anchor was captured.
  const title = (() => {
    if (errored) return "SEO API spend lookup failed";
    if (!data) return "Loading SEO API spend";
    if (data.state === "error") return "DataForSEO unreachable";
    return `Month-to-date since ${data.anchorDate ?? data.sinceIso}, as of ${new Date(data.asOfIso).toLocaleString()}`;
  })();

  return (
    <div className="flex flex-col leading-tight">
      <span className="text-[9px] uppercase tracking-wider text-white/40">
        SEO API spend
      </span>
      <span
        className="text-xs font-medium tabular-nums text-white/80"
        title={title}
      >
        {displayValue}
        <span className="ml-1 text-[9px] uppercase text-white/40">MTD</span>
      </span>
    </div>
  );
}
