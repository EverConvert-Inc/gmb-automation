import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "error" | "info";

const tones: Record<
  Tone,
  { container: string; icon: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  success: {
    container:
      "border-green-200 bg-green-50 text-green-900 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-100",
    icon: "text-green-600 dark:text-green-400",
    Icon: CheckCircle2,
  },
  warning: {
    container:
      "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100",
    icon: "text-amber-600 dark:text-amber-400",
    Icon: AlertTriangle,
  },
  error: {
    container:
      "border-red-200 bg-red-50 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100",
    icon: "text-red-600 dark:text-red-400",
    Icon: XCircle,
  },
  info: {
    container:
      "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-100",
    icon: "text-blue-600 dark:text-blue-400",
    Icon: Info,
  },
};

// Page-level banner — used for transient state callouts (just-added,
// just-connected, sync failure, etc). Tone variants ship with paired
// light/dark palettes so they read correctly in either theme.
export function Banner({
  tone,
  title,
  children,
  action,
  className,
}: {
  tone: Tone;
  title: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const t = tones[tone];
  const Icon = t.Icon;
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-md border p-4 text-sm sm:flex-row sm:items-start",
        t.container,
        className,
      )}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 flex-shrink-0", t.icon)} />
      <div className="flex-1">
        <div className="font-medium">{title}</div>
        {children && <div className="mt-0.5 opacity-90">{children}</div>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}
