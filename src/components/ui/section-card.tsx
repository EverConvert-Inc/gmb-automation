import * as React from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Section wrapper that gives each top-level card a consistent visual
// identity: brand-tinted icon chip in the header, optional eyebrow label,
// a right-side actions slot, and a subtle bottom border under the header.
// Use this anywhere the page builds a labelled section ("Heat map",
// "Reviews", "Search rankings", ...) so they read as a coherent dashboard
// rather than a stack of unrelated panels.
export function SectionCard({
  icon,
  title,
  eyebrow,
  actions,
  className,
  headerClassName,
  contentClassName,
  id,
  children,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <Card id={id} className={cn("overflow-hidden", className)}>
      <CardHeader
        className={cn(
          "flex flex-row items-center justify-between gap-3 border-b border-border/60 bg-gradient-to-b from-muted/30 to-transparent p-5",
          headerClassName,
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          {icon && (
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand ring-1 ring-brand/20">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            {eyebrow && (
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {eyebrow}
              </div>
            )}
            <CardTitle className="truncate text-base font-semibold">
              {title}
            </CardTitle>
          </div>
        </div>
        {actions && (
          <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>
        )}
      </CardHeader>
      <CardContent className={cn("p-5", contentClassName)}>{children}</CardContent>
    </Card>
  );
}
