import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The internal app's one badge, in the client portal's badge style
 * (src/app/(portal)/portal-theme.css .portal-status-*): a soft tint of the
 * colour with deep text, and its OWN dark-mode pair rather than the light
 * one dimmed.
 *
 *   light: bg <colour>-500 at 12% (16% for amber/yellow) · text <colour>-800
 *   dark:  bg <colour>-500 at 15%                         · text <colour>-400
 *
 * The portal uses 700 text in light mode; here it is 800, because internal
 * tables put badges on grey row-hover surfaces where 700 drops under 4.5:1
 * for some colours. Every variant meets WCAG AA on the page, card and
 * row-hover surfaces in both themes (badge.test.ts).
 *
 * Colour names follow the usual badge-library set; the older names used
 * across the app (success, warning, destructive, secondary, info, default)
 * map onto them, so existing call sites keep their meaning.
 */
const COLOURS = {
  slate: "bg-slate-500/[0.12] text-slate-800 dark:bg-slate-500/[0.15] dark:text-slate-400",
  red: "bg-red-500/[0.12] text-red-800 dark:bg-red-500/[0.15] dark:text-red-400",
  orange: "bg-orange-500/[0.12] text-orange-800 dark:bg-orange-500/[0.15] dark:text-orange-400",
  amber: "bg-amber-500/[0.16] text-amber-800 dark:bg-amber-500/[0.15] dark:text-amber-400",
  yellow: "bg-yellow-500/[0.16] text-yellow-800 dark:bg-yellow-500/[0.15] dark:text-yellow-400",
  lime: "bg-lime-500/[0.12] text-lime-800 dark:bg-lime-500/[0.15] dark:text-lime-400",
  green: "bg-green-500/[0.12] text-green-800 dark:bg-green-500/[0.15] dark:text-green-400",
  emerald: "bg-emerald-500/[0.12] text-emerald-800 dark:bg-emerald-500/[0.15] dark:text-emerald-400",
  teal: "bg-teal-500/[0.12] text-teal-800 dark:bg-teal-500/[0.15] dark:text-teal-400",
  cyan: "bg-cyan-500/[0.12] text-cyan-800 dark:bg-cyan-500/[0.15] dark:text-cyan-400",
  sky: "bg-sky-500/[0.12] text-sky-800 dark:bg-sky-500/[0.15] dark:text-sky-400",
  blue: "bg-blue-500/[0.12] text-blue-800 dark:bg-blue-500/[0.15] dark:text-blue-400",
  indigo: "bg-indigo-500/[0.12] text-indigo-800 dark:bg-indigo-500/[0.15] dark:text-indigo-400",
  violet: "bg-violet-500/[0.12] text-violet-800 dark:bg-violet-500/[0.15] dark:text-violet-400",
  purple: "bg-purple-500/[0.12] text-purple-800 dark:bg-purple-500/[0.15] dark:text-purple-400",
  fuchsia: "bg-fuchsia-500/[0.12] text-fuchsia-800 dark:bg-fuchsia-500/[0.15] dark:text-fuchsia-400",
  pink: "bg-pink-500/[0.12] text-pink-800 dark:bg-pink-500/[0.15] dark:text-pink-400",
  rose: "bg-rose-500/[0.12] text-rose-800 dark:bg-rose-500/[0.15] dark:text-rose-400",
} as const;

export type BadgeColour = keyof typeof COLOURS;

/** The names the app already used, mapped onto colours. */
const ALIASES = {
  default: "slate",
  secondary: "slate",
  success: "green",
  warning: "amber",
  destructive: "red",
  info: "blue",
} as const satisfies Record<string, BadgeColour>;

export type BadgeVariant = BadgeColour | keyof typeof ALIASES | "outline";
export type BadgeSize = "default" | "sm";

const SIZES: Record<BadgeSize, string> = {
  default: "px-2 py-0.5 text-xs",
  sm: "px-1.5 py-px text-[10px]",
};

export const BADGE_COLOURS = Object.keys(COLOURS) as BadgeColour[];

/** The classes, for a non-span element (e.g. a Link styled as a badge). */
export function badgeClasses(variant: BadgeVariant = "default", size: BadgeSize = "default", className?: string): string {
  const colour =
    variant === "outline"
      ? "border border-border text-muted-foreground"
      : COLOURS[(ALIASES as Record<string, BadgeColour>)[variant] ?? (variant as BadgeColour)];
  return cn("inline-flex items-center rounded-md font-medium", SIZES[size], colour, className);
}

export function Badge({
  variant = "default",
  size = "default",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant; size?: BadgeSize }) {
  return <span className={badgeClasses(variant, size, className)} {...props} />;
}
