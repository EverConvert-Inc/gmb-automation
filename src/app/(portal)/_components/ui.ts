// Portal-only control styles. The shared Button in src/components/ui is the
// internal app's, so the portal keeps its own rather than editing that one.
import { cn } from "@/lib/utils";

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const KIND = {
  primary: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
  secondary: "border bg-card text-foreground shadow-sm hover:bg-muted",
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
  "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
);

/** The brand green as TEXT: darker in light mode, so it meets contrast on white. */
export const portalAccentText = "text-[hsl(var(--portal-accent))]";

export const portalFocus = FOCUS;
