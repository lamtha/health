"use client";

import { useState } from "react";

import {
  MetricChart,
  type MetricChartPoint,
} from "@/components/health/metric-chart";
import {
  RawValuesTable,
  type RawValuePoint,
} from "@/components/health/raw-values-table";
import type { OverlayBand, OverlayMarker } from "@/lib/overlays";

interface Props {
  // Chart inputs
  metricName: string;
  units: string | null;
  chartPoints: MetricChartPoint[];
  providers: string[];
  refLow: number | null;
  refHigh: number | null;
  refLowVaries: boolean;
  refHighVaries: boolean;
  bands: OverlayBand[];
  markers: OverlayMarker[];

  // Table inputs
  tablePoints: RawValuePoint[];
  excludedKeys: Set<string>;
}

// Owns the cross-component hover state so hovering a raw-values row highlights
// the corresponding dot on the chart. Lives in a client island — the page
// remains an RSC, this wrapper is the only thing that needs browser state.
export function MetricDetailShell({
  metricName,
  units,
  chartPoints,
  providers,
  refLow,
  refHigh,
  refLowVaries,
  refHighVaries,
  bands,
  markers,
  tablePoints,
  excludedKeys,
}: Props) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  return (
    <>
      <MetricChart
        metricName={metricName}
        units={units}
        points={chartPoints}
        providers={providers}
        refLow={refLow}
        refHigh={refHigh}
        refLowVaries={refLowVaries}
        refHighVaries={refHighVaries}
        bands={bands}
        markers={markers}
        externalHoveredKey={hoveredKey}
      />
      <RawValuesTable
        points={tablePoints}
        providers={providers}
        excludedKeys={excludedKeys}
        onRowHover={setHoveredKey}
      />
    </>
  );
}
