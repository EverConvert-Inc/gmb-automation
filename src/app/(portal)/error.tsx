"use client";

import { RotateCw, TriangleAlert } from "lucide-react";
import { portalButton } from "./_components/ui";

// Deliberately says nothing about what failed: no message, no digest, no
// stack. Details stay in the server logs.
export default function PortalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-8 text-center shadow-sm">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <TriangleAlert aria-hidden className="h-6 w-6 text-muted-foreground" />
        </span>
        <h1 className="mt-4 font-display text-lg font-semibold">Something went wrong</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This page couldn&apos;t load right now. Please try again in a moment.
        </p>
        <button type="button" onClick={reset} className={portalButton("primary", "md", "mt-6")}>
          <RotateCw aria-hidden className="h-4 w-4" />
          Try again
        </button>
      </div>
    </div>
  );
}
