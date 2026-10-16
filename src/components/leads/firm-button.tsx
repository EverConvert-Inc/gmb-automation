import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The firm page's ONE button for primary (green) and danger actions.
 *
 * - danger: exactly the requested classes; the same in light and dark.
 * - primary: the requested classes are the DARK look (dark:); light mode
 *   pairs them with a light tint, since a near-black green block reads as
 *   heavy on a white page. Contrast: dark 6.0:1, light 7.3:1.
 * Hover, keyboard focus and disabled states are shared.
 */
const VARIANTS = {
  danger:
    "rounded-xl bg-gradient-to-t from-red-600 to-red-500 px-4 py-2 text-sm font-medium text-white hover:from-red-700 hover:to-red-600 focus-visible:ring-red-500",
  primary:
    "py-2 px-4 rounded-xl text-sm font-medium border bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-500 dark:border-emerald-900 dark:hover:bg-emerald-900 focus-visible:ring-emerald-500",
} as const;

export type FirmButtonVariant = keyof typeof VARIANTS;

export function firmButtonClasses(variant: FirmButtonVariant, className?: string): string {
  return cn(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:cursor-not-allowed disabled:opacity-50",
    VARIANTS[variant],
    className,
  );
}

export const FirmButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant: FirmButtonVariant }
>(({ variant, className, type = "button", ...props }, ref) => (
  <button ref={ref} type={type} className={firmButtonClasses(variant, className)} {...props} />
));
FirmButton.displayName = "FirmButton";
