import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  Clock,
  Crosshair,
  ExternalLink,
  MapPin,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { StarBar } from "@/components/star-bar";
import { StatTile } from "@/components/ui/stat-tile";
import { formatRelativeDate, formatRelativeTime } from "@/lib/utils";

type Props = {
  locationId: string;
  name: string;
  address: string;
  rating: number | null;
  reviewCount: number;
  placeRating: number | null;
  placeReviewCount: number | null;
  placeWebsiteUri: string | null;
  placeGoogleMapsUri: string | null;
  hasGbpConnected: boolean;
  lastPolledAt: Date | null;
  nextPollAfter: Date | null;
  lastPollError: string | null;
  lastPollErrorAt: Date | null;
  consecutivePollFailures: number;
  kpis: {
    daysSinceLastReview: number | null;
    arp: number | null;
    solv: number | null;
    lastScanAt: Date | string | null;
  };
};

// Top-of-page "vitals" snapshot: identity (name, address, rating, GBP
// status, website / maps links) on the left, a four-tile KPI strip on
// the right. Gives the user an at-a-glance read of the location before
// they scroll into the section detail cards below.
export function HeroSnapshotCard({
  locationId,
  name,
  address,
  rating,
  reviewCount,
  placeRating,
  placeReviewCount,
  placeWebsiteUri,
  placeGoogleMapsUri,
  hasGbpConnected,
  lastPolledAt,
  nextPollAfter,
  lastPollError,
  lastPollErrorAt,
  consecutivePollFailures,
  kpis,
}: Props) {
  const daysTone =
    kpis.daysSinceLastReview === null
      ? "default"
      : kpis.daysSinceLastReview <= 14
        ? "brand"
        : kpis.daysSinceLastReview <= 45
          ? "amber"
          : "red";

  return (
    <Card className="surface-brand-tint overflow-hidden">
      <div className="grid gap-5 p-5 lg:grid-cols-[1fr_auto] lg:gap-8">
        <div className="space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-display text-2xl font-bold tracking-tight">
                {name}
              </h2>
              <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                <span>{address}</span>
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              {hasGbpConnected ? (
                <Badge variant="success">GBP connected</Badge>
              ) : (
                <Link
                  href={`/api/oauth/google/start?locationId=${locationId}`}
                  className={buttonClasses("default", "sm")}
                >
                  Connect Google Business Profile
                </Link>
              )}
              {hasGbpConnected && (
                <div className="text-right text-xs">
                  {lastPollError ? (
                    <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400">
                      <AlertTriangle className="h-3 w-3" />
                      Last sync failed
                      {lastPollErrorAt &&
                        ` ${formatRelativeTime(lastPollErrorAt)}`}
                      {consecutivePollFailures > 1 &&
                        ` · ${consecutivePollFailures} attempts`}
                      <InfoTooltip aria-label="Error details">
                        {lastPollError}
                      </InfoTooltip>
                    </span>
                  ) : lastPolledAt ? (
                    <span className="text-muted-foreground">
                      Last sync {formatRelativeTime(lastPolledAt)}
                      {nextPollAfter &&
                        ` · next ${formatRelativeTime(nextPollAfter)}`}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      Awaiting first sync
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
            {rating !== null ? (
              <StarBar rating={rating} reviewCount={reviewCount} />
            ) : placeRating !== null ? (
              <>
                <StarBar
                  rating={Number(placeRating)}
                  reviewCount={placeReviewCount ?? 0}
                />
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  from Google Places
                </span>
              </>
            ) : hasGbpConnected ? (
              <span className="text-sm text-muted-foreground">
                Awaiting first review sync from Google.
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">
                No reviews yet.
              </span>
            )}
          </div>

          {(placeWebsiteUri || placeGoogleMapsUri) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pt-1 text-xs">
              {placeWebsiteUri && (
                <a
                  href={placeWebsiteUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-brand hover:underline"
                >
                  {placeWebsiteUri
                    .replace(/^https?:\/\//, "")
                    .replace(/\/$/, "")}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {placeGoogleMapsUri && (
                <a
                  href={placeGoogleMapsUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-muted-foreground hover:underline"
                >
                  View on Google Maps
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}
        </div>

        <div className="grid w-full grid-cols-2 gap-3 lg:w-[28rem]">
          <StatTile
            label="Days since review"
            value={
              kpis.daysSinceLastReview === null
                ? "—"
                : kpis.daysSinceLastReview === 0
                  ? "today"
                  : String(kpis.daysSinceLastReview)
            }
            tone={daysTone}
            icon={<CalendarClock className="h-4 w-4" />}
          />
          <StatTile
            label="ARP"
            value={kpis.arp !== null ? kpis.arp.toFixed(1) : "—"}
            tone="brand"
            icon={<Crosshair className="h-4 w-4" />}
          />
          <StatTile
            label="SoLV"
            value={kpis.solv !== null ? `${Math.round(kpis.solv)}%` : "—"}
            tone="brand"
            icon={<TrendingUp className="h-4 w-4" />}
          />
          <StatTile
            label="Last scan"
            value={
              kpis.lastScanAt ? formatRelativeDate(kpis.lastScanAt) : "—"
            }
            icon={<Clock className="h-4 w-4" />}
          />
        </div>
      </div>
    </Card>
  );
}

