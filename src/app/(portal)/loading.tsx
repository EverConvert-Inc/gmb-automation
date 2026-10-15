import { LoaderCircle } from "lucide-react";

export default function PortalLoading() {
  return (
    <div className="flex min-h-full items-center justify-center p-6" role="status">
      <LoaderCircle aria-hidden className="h-6 w-6 animate-spin text-muted-foreground" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
