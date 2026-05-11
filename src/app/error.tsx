"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg py-12">
      <Card>
        <CardHeader>
          <CardTitle>Something went wrong</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The page failed to load. Usual suspects:
          </p>
          <ul className="ml-5 list-disc space-y-1 text-sm text-muted-foreground">
            <li>
              Pending DB migrations — run{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                npm run db:migrate
              </code>{" "}
              against the prod{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                DATABASE_URL
              </code>
              .
            </li>
            <li>
              Missing env var (
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                DATABASE_URL
              </code>
              , Supabase keys, OAuth secrets).
            </li>
            <li>Transient database connectivity issue — retry in a few seconds.</li>
          </ul>
          {error.message && (
            <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">
              {error.message}
            </pre>
          )}
          {error.digest && (
            <p className="text-xs text-muted-foreground">
              Digest: <span className="font-mono">{error.digest}</span> · check
              Vercel logs for the full stack trace.
            </p>
          )}
          <Button onClick={reset}>Try again</Button>
        </CardContent>
      </Card>
    </div>
  );
}
