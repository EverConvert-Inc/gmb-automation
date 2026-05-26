"use client";

import { Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

// w-56 in Tailwind = 14rem = 224px. Hard-coded so we can clamp the
// portal-rendered bubble to the viewport without having to measure it.
const BUBBLE_WIDTH = 224;
const VIEWPORT_PADDING = 8;

// Portal-rendered tooltip. The trigger stays inline; the bubble is appended to
// document.body on open so it can escape `overflow:hidden` / `overflow-x-auto`
// ancestors (e.g. table scroll wrappers). Position is recomputed from the
// trigger's bounding rect on open and on scroll/resize while open, and the
// left coordinate is clamped so the bubble stays inside the viewport even
// when the trigger sits near the right edge of the screen.
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const updatePosition = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const triggerCenter = r.left + r.width / 2;
    const idealLeft = triggerCenter - BUBBLE_WIDTH / 2;
    const maxLeft = window.innerWidth - BUBBLE_WIDTH - VIEWPORT_PADDING;
    const clampedLeft = Math.max(
      VIEWPORT_PADDING,
      Math.min(idealLeft, maxLeft),
    );
    setCoords({
      top: side === "top" ? r.top : r.bottom,
      left: clampedLeft,
    });
  };

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => updatePosition();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleOpen = () => {
    updatePosition();
    setOpen(true);
  };
  const handleClose = () => setOpen(false);

  const bubble =
    mounted && open && coords
      ? createPortal(
          <span
            role="tooltip"
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              width: BUBBLE_WIDTH,
              transform:
                side === "top"
                  ? "translateY(calc(-100% - 8px))"
                  : "translateY(8px)",
            }}
            className="pointer-events-none z-[1000] rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] font-normal normal-case leading-snug text-slate-50 shadow-lg"
          >
            {children}
          </span>,
          document.body,
        )
      : null;

  return (
    <span className={cn("inline-flex", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        onMouseEnter={handleOpen}
        onMouseLeave={handleClose}
        onFocus={handleOpen}
        onBlur={handleClose}
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-muted-foreground/70 hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {bubble}
    </span>
  );
}
