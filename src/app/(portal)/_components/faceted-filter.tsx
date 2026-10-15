"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, CirclePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { portalFocus } from "./ui";

export type FacetOption<V extends string> = { value: V; label: string; dotClass?: string };

/**
 * A React take on shadcn's "data table faceted filter", without Radix, cmdk
 * or TanStack (none are installed): a trigger with a selected-count badge,
 * opening a popover with a search box, a multi-select list showing each
 * option's count, and a clear button.
 *
 * Keyboard: the search box takes focus when the popover opens; Up/Down move
 * through the options; Enter or Space toggles one; Escape closes and returns
 * focus to the trigger. The popover is always in the markup and `hidden`
 * while closed.
 */
export function FacetedFilter<V extends string>({
  title,
  options,
  selected,
  counts,
  onChange,
}: {
  title: string;
  options: readonly FacetOption<V>[];
  selected: ReadonlySet<V>;
  counts: Readonly<Record<V, number>>;
  onChange: (next: Set<V>) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, search]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  useEffect(() => setActive(0), [search, open]);

  function toggle(value: V) {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  }

  function close() {
    setOpen(false);
    setSearch("");
    triggerRef.current?.focus();
  }

  const selectedOptions = options.filter((o) => selected.has(o.value));
  const optionId = (i: number) => `${id}-opt-${i}`;

  return (
    <div
      ref={wrapRef}
      className="relative"
      onBlur={(e) => {
        if (open && !wrapRef.current?.contains(e.relatedTarget as Node | null)) {
          setOpen(false);
          setSearch("");
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => (open ? close() : setOpen(true))}
        className={cn(
          "inline-flex h-9 items-center gap-2 rounded-lg border border-dashed bg-card px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted",
          portalFocus,
        )}
      >
        <CirclePlus aria-hidden className="h-4 w-4 text-muted-foreground" />
        {title}
        {selected.size > 0 && (
          <>
            <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
            {/* On a phone, or with more than two picked, just the count. */}
            <span className={cn("portal-filter-pill", selected.size > 2 ? "" : "sm:hidden")}>
              {selected.size} selected
            </span>
            {selected.size <= 2 && (
              <span className="hidden gap-1 sm:flex">
                {selectedOptions.map((o) => (
                  <span key={o.value} className="portal-filter-pill">
                    {o.label}
                  </span>
                ))}
              </span>
            )}
          </>
        )}
      </button>

      <div
        id={`${id}-panel`}
        role="dialog"
        aria-label={`Filter by ${title.toLowerCase()}`}
        hidden={!open}
        className="absolute left-0 top-full z-20 mt-2 w-60 max-w-[calc(100vw-2rem)] rounded-xl border bg-card shadow-lg"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            close();
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, Math.max(visible.length - 1, 0)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if ((e.key === "Enter" || (e.key === " " && e.target !== inputRef.current)) && visible[active]) {
            e.preventDefault();
            toggle(visible[active].value);
          }
        }}
      >
        <div className="border-b p-1.5">
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={title}
            aria-label={`Search ${title.toLowerCase()} options`}
            role="combobox"
            aria-expanded={open}
            aria-controls={`${id}-list`}
            aria-activedescendant={visible[active] ? optionId(active) : undefined}
            autoComplete="off"
            className="h-8 w-full rounded-md bg-transparent px-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
          />
        </div>
        <ul id={`${id}-list`} role="listbox" aria-multiselectable="true" aria-label={title} className="max-h-64 overflow-y-auto p-1.5">
          {visible.length === 0 && <li className="px-2 py-6 text-center text-sm text-muted-foreground">No results.</li>}
          {visible.map((o, i) => {
            const isSelected = selected.has(o.value);
            return (
              <li
                key={o.value}
                id={optionId(i)}
                role="option"
                aria-selected={isSelected}
                onClick={() => toggle(o.value)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-foreground",
                  i === active && open && "bg-muted",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    isSelected ? "border-primary bg-primary text-primary-foreground" : "border-input",
                  )}
                >
                  {isSelected && <Check className="h-3 w-3" />}
                </span>
                {o.dotClass && <span aria-hidden className={o.dotClass} />}
                <span className="flex-1">{o.label}</span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground" data-facet-count={o.value}>
                  {counts[o.value]}
                </span>
              </li>
            );
          })}
        </ul>
        {selected.size > 0 && (
          <div className="border-t p-1.5">
            <button
              type="button"
              onClick={() => onChange(new Set())}
              className={cn(
                "w-full rounded-md px-2 py-1.5 text-center text-sm font-medium text-foreground transition-colors hover:bg-muted",
                portalFocus,
              )}
            >
              Clear filters
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
