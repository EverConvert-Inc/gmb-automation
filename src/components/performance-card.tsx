import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { DeltaPill, SparkLine } from "@/components/charts";
import type { PerformanceMetric } from "@/lib/gbp";
import type { PerformanceInsights, PerformanceTile } from "@/lib/queries";

const TILE_LABELS: Record<string, string> = {
  CALL_CLICKS: "Calls",
  WEBSITE_CLICKS: "Website",
  BUSINESS_DIRECTION_REQUESTS: "Directions",
  BUSINESS_CONVERSATIONS: "Conversations",
  BUSINESS_BOOKINGS: "Bookings",
  BUSINESS_FOOD_ORDERS: "Food orders",
  BUSINESS_FOOD_MENU_CLICKS: "Menu clicks",
};

const TILE_DESCRIPTIONS: Record<string, string> = {
  CALL_CLICKS: "Times someone tapped the call button on your Google listing.",
  WEBSITE_CLICKS: "Clicks on your website link from Google.",
  BUSINESS_DIRECTION_REQUESTS:
    "Direction requests to this location from Google Maps.",
  BUSINESS_CONVERSATIONS: "Chats started via Google's messaging.",
  BUSINESS_BOOKINGS: "Bookings made through Google's booking flow.",
  BUSINESS_FOOD_ORDERS: "Food orders placed via Google.",
  BUSINESS_FOOD_MENU_CLICKS: "Clicks on the menu link on your listing.",
};

const PRIMARY_METRICS: PerformanceMetric[] = [
  "CALL_CLICKS",
  "BUSINESS_DIRECTION_REQUESTS",
  "WEBSITE_CLICKS",
  "BUSINESS_CONVERSATIONS",
];

const IMPRESSIONS_METRICS: PerformanceMetric[] = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
];

const SECONDARY_METRICS: PerformanceMetric[] = [
  "BUSINESS_BOOKINGS",
  "BUSINESS_FOOD_ORDERS",
  "BUSINESS_FOOD_MENU_CLICKS",
];

export function PerformanceCard({ data }: { data: PerformanceInsights }) {
  const tilesByMetric = new Map(data.tiles.map((t) => [t.metric, t]));

  const anyData = data.tiles.some((t) => t.last30 > 0 || t.prior30 > 0);
  if (!anyData) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No Google Business Profile performance data yet. New listings can
            take a few days for metrics to appear, and Google publishes daily
            data with a 2&ndash;3 day lag.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Sum the four impression buckets into a single tile.
  const impressionsLast30 = IMPRESSIONS_METRICS.reduce(
    (acc, m) => acc + (tilesByMetric.get(m)?.last30 ?? 0),
    0,
  );
  const impressionsPrior30 = IMPRESSIONS_METRICS.reduce(
    (acc, m) => acc + (tilesByMetric.get(m)?.prior30 ?? 0),
    0,
  );
  const impressionsDailyByDate = new Map<string, number>();
  for (const m of IMPRESSIONS_METRICS) {
    const tile = tilesByMetric.get(m);
    if (!tile) continue;
    for (const d of tile.daily) {
      impressionsDailyByDate.set(
        d.date,
        (impressionsDailyByDate.get(d.date) ?? 0) + d.value,
      );
    }
  }
  const impressionsDaily = Array.from(impressionsDailyByDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, v]) => v);

  const secondaryHasData = SECONDARY_METRICS.some((m) => {
    const t = tilesByMetric.get(m);
    return t && (t.last30 > 0 || t.prior30 > 0);
  });

  // If we don't have 60 days of history yet, the "vs prior 30d" comparison
  // is misleading (prior window is partly empty). Flag that on the header.
  const haveFullPriorWindow =
    data.earliestDataDate !== null &&
    new Date(data.earliestDataDate).getTime() <=
      Date.now() - 60 * 86_400_000;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            Performance
            <InfoTooltip>
              Counts come straight from Google Business Profile. Google
              publishes daily totals with a 2&ndash;3 day lag, so today&apos;s
              numbers will fill in over the next couple of days.
            </InfoTooltip>
          </span>
          <span className="text-[11px] font-normal normal-case text-muted-foreground">
            Last 30 days vs prior 30 days
            {!haveFullPriorWindow &&
              data.earliestDataDate &&
              ` · prior window partial (data since ${data.earliestDataDate})`}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {PRIMARY_METRICS.map((m) => {
            const tile = tilesByMetric.get(m);
            if (!tile) return null;
            return (
              <PerfTile
                key={m}
                label={TILE_LABELS[m]}
                info={TILE_DESCRIPTIONS[m]}
                tile={tile}
              />
            );
          })}
          <PerfTile
            label="Impressions"
            info="Times your listing was shown on Google Search or Maps in the last 30 days. Sums Desktop+Mobile across Search+Maps."
            tile={{
              metric: "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
              last30: impressionsLast30,
              prior30: impressionsPrior30,
              daily: impressionsDaily.map((v, i) => ({
                date: String(i),
                value: v,
              })),
            }}
          />
        </div>

        {secondaryHasData && (
          <div className="border-t pt-4">
            <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              Bookings &amp; food
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {SECONDARY_METRICS.map((m) => {
                const tile = tilesByMetric.get(m);
                if (!tile) return null;
                return (
                  <PerfTile
                    key={m}
                    label={TILE_LABELS[m]}
                    info={TILE_DESCRIPTIONS[m]}
                    tile={tile}
                  />
                );
              })}
            </div>
          </div>
        )}

        {data.lastDataDate && (
          <div className="text-[11px] text-muted-foreground">
            Latest data from Google: {data.lastDataDate}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PerfTile({
  label,
  info,
  tile,
}: {
  label: string;
  info: string;
  tile: PerformanceTile;
}) {
  const sparkValues = tile.daily.map((d) => d.value);
  return (
    <div className="rounded-md border bg-muted/10 p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        <span>{label}</span>
        <InfoTooltip>{info}</InfoTooltip>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="text-2xl font-semibold tabular-nums">
          {tile.last30.toLocaleString()}
        </span>
        <DeltaPill current={tile.last30} prior={tile.prior30} />
      </div>
      {sparkValues.length > 1 && (
        <SparkLine
          values={sparkValues}
          width={180}
          height={28}
          className="mt-1 text-foreground"
        />
      )}
    </div>
  );
}
