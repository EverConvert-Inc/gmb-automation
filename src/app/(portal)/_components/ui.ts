// Portal-only control styles. The shared Button in src/components/ui is the
// internal app's, so the portal keeps its own rather than editing that one.
import { cn } from "@/lib/utils";

// Every green below is a --portal-green-* token from portal-theme.css.
const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--portal-green-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const KIND = {
  // Muted deep green, white text. Disabled keeps the resting colour, faded.
  primary:
    "bg-[var(--portal-green-solid)] text-white shadow-sm hover:bg-[var(--portal-green-solid-hover)] active:bg-[var(--portal-green-solid-hover)] disabled:hover:bg-[var(--portal-green-solid)]",
  // Deep green text, no fill; a soft tint on hover.
  secondary:
    "border bg-card text-[var(--portal-green-text)] shadow-sm hover:bg-[var(--portal-green-soft)]",
  ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
} as const;

const SIZE = {
  sm: "h-8 gap-1.5 rounded-md px-3 text-xs",
  md: "h-10 gap-2 rounded-lg px-4 text-sm",
} as const;

export function portalButton(kind: keyof typeof KIND, size: keyof typeof SIZE = "md", extra?: string) {
  return cn(
    "inline-flex items-center justify-center whitespace-nowrap font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    FOCUS,
    KIND[kind],
    SIZE[size],
    extra,
  );
}

export const portalInput = cn(
  "block w-full rounded-lg border bg-card px-3 py-2 text-sm text-foreground shadow-sm transition-colors",
  "placeholder:text-muted-foreground/70",
  "focus-visible:border-[var(--portal-green-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--portal-green-ring)]",
);

/** Deep green text (links, icons, secondary actions). */
export const portalAccentText = "text-[var(--portal-green-text)]";

/** A selected state: soft tint, deep green text, thin ring. Never a solid fill. */
export const portalSelected =
  "bg-[var(--portal-green-soft)] text-[var(--portal-green-text)] shadow-[inset_0_0_0_1px_var(--portal-green-ring)]";

export const portalFocus = FOCUS;
