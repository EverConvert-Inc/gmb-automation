"use client";

import { useRef } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export type KeywordTab = {
  id: string;
  keyword: string;
  isPrimary: boolean;
};

type Props = {
  keywords: KeywordTab[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function HeatMapKeywordTabs({ keywords, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  if (keywords.length <= 1) return null;

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, idx: number) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = e.key === "ArrowRight" ? idx + 1 : idx - 1;
    const target = keywords[(next + keywords.length) % keywords.length];
    onSelect(target.id);
    const node = containerRef.current?.querySelectorAll<HTMLButtonElement>(
      "[role='tab']",
    );
    node?.[(next + keywords.length) % keywords.length]?.focus();
  }

  return (
    <div
      ref={containerRef}
      role="tablist"
      aria-label="Keywords"
      className="flex gap-1 overflow-x-auto pb-1"
    >
      {keywords.map((kw, idx) => {
        const selected = kw.id === selectedId;
        return (
          <button
            key={kw.id}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(kw.id)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background hover:bg-muted",
            )}
          >
            {kw.isPrimary && (
              <Star
                className={cn(
                  "h-3.5 w-3.5",
                  selected
                    ? "fill-yellow-300 text-yellow-300"
                    : "fill-yellow-400 text-yellow-400",
                )}
              />
            )}
            <span className="whitespace-nowrap">{kw.keyword}</span>
          </button>
        );
      })}
    </div>
  );
}
