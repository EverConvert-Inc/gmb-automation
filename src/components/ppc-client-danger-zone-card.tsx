"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Rendered last on the page, after every other client-settings card
// (including tag categories) — deliberately positioned at the very
// bottom so it isn't the first destructive action an operator scrolls
// past while looking for something else.
export function PpcClientDangerZoneCard({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const router = useRouter();

  async function deleteClient() {
    if (
      !confirm(
        `Delete "${name}"? All Google Ads and CallRail history for this PPC client will be removed.`,
      )
    ) {
      return;
    }
    const res = await fetch(`/api/ppc/clients/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error("Delete failed");
      return;
    }
    toast.success(`${name} deleted`);
    router.push("/ppc/clients");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base text-red-700 dark:text-red-400">
          Danger zone
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" size="sm" onClick={deleteClient}>
          <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete PPC client
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          Removes the client record, its campaigns, daily Google Ads rows,
          and CallRail rollups. The OAuth credential row is kept in case
          another client reuses it.
        </p>
      </CardContent>
    </Card>
  );
}
