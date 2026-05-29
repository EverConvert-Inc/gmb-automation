"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Calendar } from "lucide-react";

// Returns YYYY-MM-DD for a Date in UTC.
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type Preset = {
  key: string;
  label: string;
  // Returns [from, to] in YYYY-MM-DD.
  range: () => [string, string];
};

function presets(): Preset[] {
  return [
    {
      key: "last7",
      label: "Last 7 days",
      range: () => {
        const to = new Date();
        const from = new Date(to);
        from.setUTCDate(from.getUTCDate() - 6);
        return [iso(from), iso(to)];
      },
    },
    {
      key: "last30",
      label: "Last 30 days",
      range: () => {
        const to = new Date();
        const from = new Date(to);
        from.setUTCDate(from.getUTCDate() - 29);
        return [iso(from), iso(to)];
      },
    },
    {
      key: "mtd",
      label: "This month",
      range: () => {
        const to = new Date();
        const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
        return [iso(from), iso(to)];
      },
    },
    {
      key: "lastMonth",
      label: "Last month",
      range: () => {
        const now = new Date();
        const from = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
        );
        const to = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0),
        );
        return [iso(from), iso(to)];
      },
    },
    {
      key: "last90",
      label: "Last 90 days",
      range: () => {
        const to = new Date();
        const from = new Date(to);
        from.setUTCDate(from.getUTCDate() - 89);
        return [iso(from), iso(to)];
      },
    },
  ];
}

// Renders preset chips + custom from/to inputs. Updates the page URL's
// from/to params so the server component refetches.
export function PpcDateRangeFilter({
  from,
  to,
}: {
  from: string;
  to: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [localFrom, setLocalFrom] = useState(from);
  const [localTo, setLocalTo] = useState(to);

  useEffect(() => setLocalFrom(from), [from]);
  useEffect(() => setLocalTo(to), [to]);

  const presetList = useMemo(presets, []);
  const activePresetKey = useMemo(() => {
    for (const p of presetList) {
      const [pf, pt] = p.range();
      if (pf === from && pt === to) return p.key;
    }
    return "custom";
  }, [from, to, presetList]);

  function setRange(nextFrom: string, nextTo: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", nextFrom);
    params.set("to", nextTo);
    router.push(`?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Calendar className="h-4 w-4 text-muted-foreground" aria-hidden />
      <div className="inline-flex flex-wrap gap-1">
        {presetList.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => {
              const [f, t] = p.range();
              setRange(f, t);
            }}
            className={
              activePresetKey === p.key
                ? "rounded-full border border-brand bg-brand/10 px-2.5 py-1 font-medium text-foreground"
                : "rounded-full border border-border bg-background px-2.5 py-1 text-muted-foreground hover:border-foreground/40 hover:text-foreground"
            }
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-1">
        <input
          type="date"
          value={localFrom}
          onChange={(e) => setLocalFrom(e.target.value)}
          onBlur={() => {
            if (localFrom && localFrom !== from) setRange(localFrom, localTo);
          }}
          className="rounded-md border bg-background px-2 py-1"
        />
        <span className="text-muted-foreground">–</span>
        <input
          type="date"
          value={localTo}
          onChange={(e) => setLocalTo(e.target.value)}
          onBlur={() => {
            if (localTo && localTo !== to) setRange(localFrom, localTo);
          }}
          className="rounded-md border bg-background px-2 py-1"
        />
      </div>
    </div>
  );
}
