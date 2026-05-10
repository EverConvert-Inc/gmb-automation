import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function ClientDashboardLoading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true">
      <div className="space-y-2">
        <div className="h-7 w-64 rounded bg-muted" />
        <div className="h-4 w-80 rounded bg-muted" />
      </div>
      <div className="flex gap-2 border-b pb-px">
        <div className="h-9 w-32 rounded-t bg-muted" />
        <div className="h-9 w-32 rounded-t bg-muted/60" />
      </div>
      <Card>
        <CardHeader>
          <div className="h-5 w-32 rounded bg-muted" />
        </CardHeader>
        <CardContent>
          <div className="h-[400px] rounded bg-muted/40" />
        </CardContent>
      </Card>
    </div>
  );
}
