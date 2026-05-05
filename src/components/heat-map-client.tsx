"use client";

import dynamic from "next/dynamic";
import type { HeatMapProps } from "./heat-map";

const HeatMap = dynamic(() => import("./heat-map").then((m) => m.HeatMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-[600px] w-full items-center justify-center rounded-lg border bg-muted/30 text-sm text-muted-foreground">
      Loading map…
    </div>
  ),
});

export function HeatMapClient(props: HeatMapProps) {
  return <HeatMap {...props} />;
}
