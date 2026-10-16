import Link from "next/link";
import { cn } from "@/lib/utils";
import { fuAttention, fuDone } from "./firm-ui";

export type FirmStatus = {
  companiesMapped: number;
  activeLogins: number;
  leadsSynced: number;
  visibleNow: number;
  inQueue: number;
};

type Tile = { key: string; label: string; value: string; tone: "ok" | "todo" | "plain" | "attention"; href?: string };

export function statusTiles(s: FirmStatus): Tile[] {
  return [
    {
      key: "company",
      label: "CallRail",
      value: s.companiesMapped > 0 ? `${s.companiesMapped} mapped` : "Not mapped",
      tone: s.companiesMapped > 0 ? "ok" : "todo",
    },
    {
      key: "logins",
      label: "Client login",
      value: s.activeLogins > 0 ? `${s.activeLogins} active` : "None",
      tone: s.activeLogins > 0 ? "ok" : "todo",
    },
    { key: "synced", label: "Leads synced", value: String(s.leadsSynced), tone: "plain" },
    { key: "visible", label: "Visible now", value: String(s.visibleNow), tone: "plain" },
    {
      key: "queue",
      label: "In queue",
      value: String(s.inQueue),
      tone: s.inQueue > 0 ? "attention" : "plain",
      href: "/admin/leads/queue",
    },
  ];
}

/** The at-a-glance strip under the firm name. Replaces the old warning boxes. */
export function FirmStatusStrip({ status }: { status: FirmStatus }) {
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3">
      {statusTiles(status).map((t) => {
        const body = (
          <>
            <dt className="text-xs font-medium text-muted-foreground">{t.label}</dt>
            <dd
              className={cn(
                "mt-1 w-fit rounded-md text-sm font-semibold tabular-nums",
                t.tone === "ok" && cn(fuDone, "px-2 py-0.5"),
                t.tone === "todo" && "px-0 text-muted-foreground",
                t.tone === "attention" && cn(fuAttention, "px-2 py-0.5"),
                t.tone === "plain" && "text-lg",
              )}
            >
              {t.value}
            </dd>
          </>
        );
        return (
          <div key={t.key} data-tile={t.key} className={cn("rounded-lg border bg-card px-3 py-2.5", t.key === "queue" && "col-span-2 sm:col-span-1")}>
            {t.href ? (
              <Link href={t.href} className="block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {body}
              </Link>
            ) : (
              body
            )}
          </div>
        );
      })}
    </dl>
  );
}
