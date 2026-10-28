import type { Metadata } from "next";
import { KeyRound } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { buttonClasses } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/section-card";
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

// Connection status for the agency-wide Reddit Ads login. Not in the
// sidebar yet: ad account discovery, client mapping and the spend report
// itself aren't built, so this page only covers connecting.
export default async function RedditAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ reddit_link?: string; reason?: string; user?: string }>;
}) {
  const { reddit_link, reason, user } = await searchParams;
  const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
  const credentials = await listRedditCredentials();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Reddit Ads</h1>
        <p className="text-sm text-muted-foreground">
          Connect the Reddit login that can see every client ad account, including accounts
          shared with us by partners.
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
            <a href="/api/oauth/reddit-ads/start" className={buttonClasses("default", "sm")}>
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
    </div>
  );
}
