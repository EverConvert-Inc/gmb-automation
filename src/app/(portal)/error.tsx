"use client";

// Deliberately says nothing about what failed: no message, no digest, no
// stack. Details stay in the server logs.
export default function PortalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4 rounded-lg border bg-card p-6 text-center">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          This page couldn&apos;t load right now. Please try again in a moment.
        </p>
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
