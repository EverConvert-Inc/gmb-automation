import { cn } from "@/lib/utils";

/**
 * The portal's loading spinner: two curved arrows chasing each other round a
 * radius-7 circle centred at (12,12), like a refresh/sync icon. Each arrow is
 * an arc plus a two-segment hook at its end (no SVG markers, which can point
 * the wrong way), stroke-only, one solid colour each. The whole SVG rotates.
 *
 * Colours default to CSS variables in portal-theme.css: a blue accent, and a
 * second arrow that is white in dark mode but near-black in light mode, where
 * white would vanish on the page and on cards. Pass `accent` / `second` to
 * override, e.g. when an arrow would match a button's background.
 */
export function PortalSpinner({
  size = 20,
  label = "Loading",
  decorative = false,
  accent,
  second,
  className,
}: {
  size?: number;
  /** Announced to screen readers unless decorative. */
  label?: string;
  /** Inside a button that already says what is happening: hide from screen readers. */
  decorative?: boolean;
  accent?: string;
  second?: string;
  className?: string;
}) {
  const a11y = decorative ? { "aria-hidden": true as const } : { role: "status", "aria-label": label };
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      className={cn("portal-loader shrink-0", className)}
      {...a11y}
    >
      {/* Top arrow: over the top, left to right. */}
      <g
        style={{ stroke: accent ?? "var(--portal-loader-accent)" }}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="18.58 6.61 18.58 9.61 15.58 9.61" />
        <path d="M5.42 9.61A7 7 0 0 1 18.58 9.61" />
      </g>
      {/* Bottom arrow: under the bottom, right to left. */}
      <g
        style={{ stroke: second ?? "var(--portal-loader-second)" }}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="5.42 17.39 5.42 14.39 8.42 14.39" />
        <path d="M18.58 14.39A7 7 0 0 1 5.42 14.39" />
      </g>
    </svg>
  );
}

/**
 * Full-page loading layer: fixed, full-screen, the page colour at ~40% with a
 * 12px backdrop blur, the spinner centred at 44px.
 */
export function PortalLoadingOverlay({ label = "Loading" }: { label?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/40 backdrop-blur-md">
      <PortalSpinner size={44} label={label} />
    </div>
  );
}
