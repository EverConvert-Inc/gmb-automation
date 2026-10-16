"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DayPicker, type DateRange } from "react-day-picker";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { closesOnFocusOut } from "../_lib/popover";
import { formatPortalRange } from "./format";
import { PortalSpinner } from "./loader";
import { portalButton, portalFocus } from "./ui";

type Preset = "current" | "previous";

// The calendar works in plain calendar days. Eastern "YYYY-MM-DD" strings
// from the server become local-midnight Dates for display and back again,
// so the browser's own time zone never shifts a day.
const toDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const toIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The URL for a range or preset. The SERVER re-checks every value. */
export function portalRangeHref(target: Preset | { from: string; to: string }): string {
  if (target === "current") return "/portal";
  if (target === "previous") return "/portal?month=previous";
  return `/portal?from=${encodeURIComponent(target.from)}&to=${encodeURIComponent(target.to)}`;
}

/**
 * The date range control: a button showing the applied range, opening a
 * popover with the This month / Last month presets and a range calendar.
 * Picking days only changes the draft; nothing is loaded until Apply (or a
 * preset) — one server render per decision, not per click.
 *
 * Days outside the allowed window (min..max, from range.ts on the server)
 * are disabled, and the server refuses them anyway.
 */
export function DateRangePicker({
  from,
  to,
  min,
  max,
  preset,
}: {
  from: string;
  to: string;
  min: string;
  max: string;
  preset: Preset | null;
}) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>({ from: toDate(from), to: toDate(to) });
  const [wide, setWide] = useState(false);
  const [pending, startNavigation] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Two months side by side from 640px up; one month on a phone.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Reopening starts from what is applied, not a half-made draft.
  useEffect(() => {
    if (open) {
      setDraft({ from: toDate(from), to: toDate(to) });
      panelRef.current?.querySelector<HTMLElement>("button:not([disabled])")?.focus();
    }
  }, [open, from, to]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function go(href: string) {
    setOpen(false);
    triggerRef.current?.focus();
    startNavigation(() => router.push(href));
  }

  const draftFrom = draft?.from ? toIso(draft.from) : null;
  const draftTo = draft?.to ? toIso(draft.to) : draftFrom;
  const canApply = draftFrom !== null && draftTo !== null && (draftFrom !== from || draftTo !== to);
  const minDate = toDate(min);
  const maxDate = toDate(max);

  return (
    <div
      ref={wrapRef}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.preventDefault();
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
      onBlur={(e) => {
        if (open && closesOnFocusOut(wrapRef.current, e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex h-10 items-center gap-2 rounded-lg border bg-card px-3.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted",
          portalFocus,
        )}
      >
        {pending ? (
          <PortalSpinner size={16} label="Loading dates" />
        ) : (
          <CalendarDays aria-hidden className="h-4 w-4 text-muted-foreground" />
        )}
        <span data-range-label>{formatPortalRange({ from, to }, preset)}</span>
        <ChevronDown aria-hidden className="h-4 w-4 text-muted-foreground" />
      </button>

      <div
        ref={panelRef}
        id={`${id}-panel`}
        role="dialog"
        aria-label="Choose dates"
        hidden={!open}
        className="absolute left-0 top-full z-20 mt-2 w-max max-w-[calc(100vw-2rem)] rounded-xl border bg-card shadow-lg sm:left-auto sm:right-0"
      >
        <div className="flex flex-col sm:flex-row">
          <div className="flex gap-1 border-b p-2 sm:w-36 sm:flex-col sm:border-b-0 sm:border-r">
            {(
              [
                ["current", "This month"],
                ["previous", "Last month"],
              ] as const
            ).map(([p, label]) => (
              <button
                key={p}
                type="button"
                aria-pressed={preset === p}
                onClick={() => go(portalRangeHref(p))}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-left text-sm font-medium transition-colors sm:flex-none",
                  portalFocus,
                  preset === p ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="p-3">
            <DayPicker
              mode="range"
              selected={draft}
              onSelect={setDraft}
              numberOfMonths={wide ? 2 : 1}
              defaultMonth={wide ? minDate : toDate(to)}
              startMonth={minDate}
              endMonth={maxDate}
              disabled={[{ before: minDate }, { after: maxDate }]}
              excludeDisabled
              today={maxDate}
              showOutsideDays={false}
              weekStartsOn={0}
              components={{
                Chevron: ({ orientation }) =>
                  orientation === "left" ? (
                    <ChevronLeft aria-hidden className="h-4 w-4" />
                  ) : (
                    <ChevronRight aria-hidden className="h-4 w-4" />
                  ),
              }}
              classNames={{
                root: "relative",
                months: "flex flex-col gap-4 sm:flex-row sm:gap-6",
                month: "space-y-3",
                month_caption: "flex h-8 items-center justify-center",
                caption_label: "text-sm font-semibold text-foreground",
                nav: "absolute inset-x-0 top-0 z-10 flex h-8 items-center justify-between",
                button_previous: cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30",
                  portalFocus,
                ),
                button_next: cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30",
                  portalFocus,
                ),
                month_grid: "border-collapse",
                weekdays: "flex",
                weekday: "w-9 text-center text-xs font-medium text-muted-foreground",
                week: "mt-1 flex",
                day: cn(
                  "relative h-9 w-9 p-0 text-center text-sm",
                  "[&.portal-range-middle]:bg-primary/15 [&.portal-range-start]:rounded-l-md [&.portal-range-end]:rounded-r-md",
                  "[&.portal-range-start]:bg-primary/15 [&.portal-range-end]:bg-primary/15",
                ),
                day_button: cn(
                  "inline-flex h-9 w-9 items-center justify-center rounded-md text-sm text-foreground transition-colors hover:bg-muted disabled:pointer-events-none",
                  portalFocus,
                ),
                selected: "portal-day-selected",
                range_start: "portal-range-start",
                range_middle: "portal-range-middle",
                range_end: "portal-range-end",
                today: "portal-day-today",
                outside: "opacity-40",
                disabled: "opacity-35",
                hidden: "invisible",
              }}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3">
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {draftFrom ? formatPortalRange({ from: draftFrom, to: draftTo ?? draftFrom }, null) : "Pick a start date"}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
              className={portalButton("ghost", "sm")}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canApply}
              onClick={() => draftFrom && draftTo && go(portalRangeHref({ from: draftFrom, to: draftTo }))}
              className={portalButton("primary", "sm")}
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
