import Link from "next/link";
import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { ArrowLeft, KeyRound, Layers, Users } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { buttonClasses } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/section-card";
import { RedditAccountsTable, RedditDiscoverButton } from "@/components/reddit-accounts-table";
import { RedditClientsList } from "@/components/reddit-clients-list";
import { db } from "@/lib/db/client";
import { redditAdAccounts, redditClients } from "@/lib/db/schema";
import { listRedditCredentials } from "@/lib/reddit-ads-token";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Reddit Ads accounts" };

const REQUIRED_ENV = [
  "REDDIT_ADS_APP_ID",
  "REDDIT_ADS_APP_SECRET",
  "REDDIT_ADS_REDIRECT_URI",
  "REDDIT_ADS_USER_AGENT",
] as const;

function formatWhen(d: Date): string {
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// Connection, discovered ad accounts and their client mapping, and the
// Reddit client list. Mirrors /ppc/clients + /lsa/clients, but on one page:
// there's a single agency-wide connection and no per-client settings beyond
// the name.
export default async function RedditAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ reddit_link?: string; reason?: string; user?: string }>;
}) {
  const { reddit_link, reason, user } = await searchParams;
  const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
  const [credentials, accounts, clients] = await Promise.all([
    listRedditCredentials(),
    db.query.redditAdAccounts.findMany({ orderBy: asc(redditAdAccounts.name) }),
    db.query.redditClients.findMany({ orderBy: asc(redditClients.name) }),
  ]);

  const accountCountByClient = new Map<string, number>();
  for (const a of accounts) {
    if (a.redditClientId) {
      accountCountByClient.set(a.redditClientId, (accountCountByClient.get(a.redditClientId) ?? 0) + 1);
    }
  }
  const unmapped = accounts.filter((a) => a.isActive && !a.redditClientId).length;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-1">
        <Link
          href="/reddit"
          className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-1 h-3 w-3" /> Reddit spend report
        </Link>
        <h1 className="text-2xl font-semibold">Reddit Ads accounts</h1>
        <p className="text-sm text-muted-foreground">
          One Reddit login covers every ad account, including accounts partners share with us.
          Map each account to a client; unmapped spend shows as &ldquo;Unmapped&rdquo; in the
          report.
        </p>
      </div>

      {reddit_link === "connected" && (
        <Banner tone="success" title="Reddit connected">
          Connected as u/{user}.
        </Banner>
      )}
      {reddit_link === "me_failed" && (
        <Banner tone="warning" title="Connected, but Reddit wouldn't say who you are">
          The token was saved, but the Ads API&apos;s /me call failed — usually the Reddit app
          isn&apos;t approved for Ads API access yet. {reason}
        </Banner>
      )}
      {reddit_link === "no_refresh_token" && (
        <Banner tone="error" title="Reddit didn't return a refresh token">
          Nothing was saved. Try connecting again.
        </Banner>
      )}
      {reddit_link === "failed" && (
        <Banner tone="error" title="Reddit connection failed">
          {reason ?? "Unknown error."}
        </Banner>
      )}
      {missingEnv.length > 0 && (
        <Banner tone="warning" title="Reddit Ads isn't configured">
          Missing environment variables: {missingEnv.join(", ")}.
        </Banner>
      )}

      <SectionCard
        icon={<KeyRound className="h-4 w-4" />}
        title="Connection"
        actions={
          missingEnv.length === 0 ? (
            // Plain link, not fetch: the OAuth start route answers with a
            // redirect to reddit.com that the browser has to follow.
            <a href="/api/oauth/reddit-ads/start" className={buttonClasses("outline", "sm")}>
              {credentials.length > 0 ? "Reconnect Reddit" : "Connect Reddit"}
            </a>
          ) : null
        }
      >
        {credentials.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Reddit login connected yet.</p>
        ) : (
          <ul className="divide-y text-sm">
            {credentials.map((c, i) => (
              <li key={c.id} className="flex items-center justify-between gap-4 py-2">
                <span className="font-medium">
                  u/{c.accountEmail}
                  {i === 0 && credentials.length > 1 && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      (used for syncing)
                    </span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  Connected {formatWhen(c.updatedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        icon={<Layers className="h-4 w-4" />}
        title="Ad accounts"
        eyebrow={
          accounts.length
            ? `${accounts.length} discovered${unmapped ? ` · ${unmapped} unmapped` : ""}`
            : undefined
        }
        actions={credentials.length > 0 ? <RedditDiscoverButton /> : null}
      >
        <RedditAccountsTable
          accounts={accounts.map((a) => ({
            id: a.id,
            name: a.name,
            redditAdAccountId: a.redditAdAccountId,
            isShared: a.isShared,
            currency: a.currency,
            isActive: a.isActive,
            redditClientId: a.redditClientId,
            lastSeenAt: a.lastSeenAt.toISOString(),
            lastSyncAt: a.lastSyncAt?.toISOString() ?? null,
            lastSyncError: a.lastSyncError,
          }))}
          clients={clients.map((c) => ({ id: c.id, name: c.name }))}
        />
      </SectionCard>

      <SectionCard icon={<Users className="h-4 w-4" />} title="Clients">
        <RedditClientsList
          clients={clients.map((c) => ({
            id: c.id,
            name: c.name,
            accountCount: accountCountByClient.get(c.id) ?? 0,
          }))}
        />
      </SectionCard>
    </div>
  );
}
