import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2, Megaphone, Plus, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { listPpcClients } from "@/lib/queries";
import { formatRelativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "PPC clients" };

export default async function PpcClientsListPage() {
  const clients = await listPpcClients();

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Paid Search
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight">
            PPC clients
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage which businesses appear on the PPC report and how each one
            is linked to Google Ads and CallRail.
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <Link href="/ppc" className={buttonClasses("outline")}>
            Back to report
          </Link>
          <Link href="/ppc/clients/new" className={buttonClasses()}>
            <Plus className="mr-2 h-4 w-4" /> Add PPC client
          </Link>
        </div>
      </header>

      {clients.length === 0 ? (
        <Card className="surface-brand-tint">
          <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
            <div className="rounded-full bg-brand/10 p-4 ring-1 ring-brand/20">
              <Megaphone className="h-7 w-7 text-brand" />
            </div>
            <div className="max-w-md space-y-1.5">
              <p className="text-sm font-semibold">No PPC clients yet</p>
              <p className="text-xs text-muted-foreground">
                Add a client and we&apos;ll walk you through connecting Google
                Ads and CallRail.
              </p>
            </div>
            <Link href="/ppc/clients/new" className={buttonClasses()}>
              <Plus className="mr-2 h-4 w-4" /> Add the first PPC client
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Google Ads</th>
                    <th className="px-4 py-3 font-medium">CallRail</th>
                    <th className="px-4 py-3 font-medium">Last sync</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c) => {
                    const last =
                      c.lastAdsSyncAt && c.lastCallrailSyncAt
                        ? c.lastAdsSyncAt > c.lastCallrailSyncAt
                          ? c.lastAdsSyncAt
                          : c.lastCallrailSyncAt
                        : c.lastAdsSyncAt ?? c.lastCallrailSyncAt;
                    return (
                      <tr key={c.id} className="border-b last:border-0">
                        <td className="px-4 py-3 align-top font-medium">
                          {c.name}
                          {!c.isActive && (
                            <Badge
                              variant="secondary"
                              className="ml-2 text-[10px]"
                            >
                              Paused
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          {c.googleAdsLinked ? (
                            <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {c.googleAdsCustomerId}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <XCircle className="h-3.5 w-3.5" />
                              Not connected
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          {c.callrailLinked ? (
                            <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Tag: {c.signedCaseTag}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <XCircle className="h-3.5 w-3.5" />
                              Not linked
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                          {last ? formatRelativeTime(last) : "never"}
                        </td>
                        <td className="px-4 py-3 align-top text-right">
                          <Link
                            href={`/ppc/clients/${c.id}`}
                            className={buttonClasses("outline", "sm")}
                          >
                            Manage
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="space-y-2 p-3 sm:hidden">
              {clients.map((c) => {
                const last =
                  c.lastAdsSyncAt && c.lastCallrailSyncAt
                    ? c.lastAdsSyncAt > c.lastCallrailSyncAt
                      ? c.lastAdsSyncAt
                      : c.lastCallrailSyncAt
                    : c.lastAdsSyncAt ?? c.lastCallrailSyncAt;
                return (
                  <Link
                    key={c.id}
                    href={`/ppc/clients/${c.id}`}
                    className="block rounded-md border bg-background p-3"
                  >
                    <div className="font-medium">{c.name}</div>
                    <div className="mt-1 grid grid-cols-2 gap-x-2 text-[11px]">
                      <div className="text-muted-foreground">Google Ads</div>
                      <div className="text-right">
                        {c.googleAdsLinked ? c.googleAdsCustomerId : "—"}
                      </div>
                      <div className="text-muted-foreground">CallRail</div>
                      <div className="text-right">
                        {c.callrailLinked ? `tag: ${c.signedCaseTag}` : "—"}
                      </div>
                      <div className="text-muted-foreground">Last sync</div>
                      <div className="text-right">
                        {last ? formatRelativeTime(last) : "never"}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
