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
            The page failed to load. This is usually due to a missing environment
            variable or a database connection issue.
          </p>
          {error.message && (
            <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">
              {error.message}
            </pre>
          )}
          {error.digest && (
            <p className="text-xs text-muted-foreground">Digest: {error.digest}</p>
          )}
          <Button onClick={reset}>Try again</Button>
        </CardContent>
      </Card>
    </div>
  );
}
