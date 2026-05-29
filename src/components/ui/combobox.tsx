"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export type ComboBoxOption = {
  id: string;
  name: string | null;
  // Optional small annotation rendered next to the option (e.g.
  // "linked to AG Injury Law"). Use for disambiguation hints.
  meta?: string | null;
};

type Props = {
  options: ComboBoxOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  // Initial filter text. When the popover opens for the first time we
  // pre-fill the search box with this so options matching the client
  // name (or other context) surface at the top.
  prefilterText?: string;
  formatId?: (id: string) => string;
  disabled?: boolean;
  emptyLabel?: string;
  noMatchLabel?: string;
  id?: string;
  className?: string;
};

// Searchable combobox used for the Google Ads customer picker and the
// CallRail company picker. Native <select> doesn't scale to hundreds of
// options without typeahead, and the discovered customer list can be in
// the hundreds for an agency MCC.
//
// Fuzzy filter splits the query into whitespace-separated words; an option
// passes if every word is a case-insensitive substring of "name + id".
// Results are sorted by match count desc, then by name.
export function ComboBox({
  options,
  value,
  onChange,
  placeholder = "— Select —",
  prefilterText,
  formatId = (id) => id,
  disabled,
  noMatchLabel = "No matches",
  id,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);

  // Open: focus the search, pre-fill with prefilterText on first open. We
  // only seed it once per component lifetime so reopening doesn't fight
  // a query the user has cleared.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    if (!initializedRef.current && prefilterText) {
      setQuery(prefilterText);
      initializedRef.current = true;
    }
  }, [open, prefilterText]);

  // Close on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const selectedOption = useMemo(
    () => options.find((o) => o.id === value) ?? null,
    [options, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 200);
    const words = q.split(/\s+/).filter(Boolean);
    return options
      .map((o) => {
        const hay = `${o.name ?? ""} ${o.id}`.toLowerCase();
        const matches = words.filter((w) => hay.includes(w)).length;
        return { o, matches };
      })
      .filter(({ matches }) => matches > 0)
      .sort((a, b) => {
        if (a.matches !== b.matches) return b.matches - a.matches;
        return (a.o.name ?? "").localeCompare(b.o.name ?? "");
      })
      .slice(0, 200)
      .map(({ o }) => o);
  }, [options, query]);

  function pick(picked: string) {
    onChange(picked);
    setOpen(false);
  }

  function renderOptionLabel(o: ComboBoxOption) {
    if (o.name) {
      return (
        <span className="flex items-baseline gap-1.5">
          <span className="truncate font-medium">{o.name}</span>
          <span className="text-[10px] text-muted-foreground">
            {formatId(o.id)}
          </span>
        </span>
      );
    }
    return <span className="font-medium">{formatId(o.id)}</span>;
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        id={id}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors",
          "hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60",
          open && "ring-1 ring-ring",
        )}
      >
        <span className="truncate text-left">
          {selectedOption ? (
            renderOptionLabel(selectedOption)
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-md border bg-card shadow-lg">
          <div className="flex items-center gap-2 border-b px-2 py-1.5">
            <Search className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type to filter…"
              className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                {noMatchLabel}
                {query ? ` for "${query}"` : ""}
              </div>
            ) : (
              filtered.map((o) => {
                const isSelected = value === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => pick(o.id)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted/60",
                      isSelected && "bg-muted",
                    )}
                  >
                    <span className="flex-1 min-w-0">
                      {renderOptionLabel(o)}
                      {o.meta && (
                        <span className="mt-0.5 block text-[10px] text-amber-700 dark:text-amber-400">
                          {o.meta}
                        </span>
                      )}
                    </span>
                    {isSelected && (
                      <Check className="h-3.5 w-3.5 flex-shrink-0 text-brand" />
                    )}
                  </button>
                );
              })
            )}
          </div>
          {options.length > filtered.length && !query.trim() && (
            <div className="border-t bg-muted/30 px-3 py-1 text-[10px] text-muted-foreground">
              Showing first {filtered.length} of {options.length}. Type to
              search the rest.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
