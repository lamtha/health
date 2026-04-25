// Shared types + helpers for the metric chart that need to be importable
// from both server and client. Keeping pointKey here (rather than in
// metric-chart.tsx) lets server components — like /metric/[name]/page.tsx —
// build the excludedKeys set without crossing the "use client" boundary.

export interface MetricChartPoint {
  reportId: number;
  provider: string;
  date: string;
  timestamp: number;
  value: number;
  units: string | null;
  flag: "high" | "low" | "ok" | null;
  // Per-point ref range, in the same scale as `value` (converted when a
  // per-metric unit spec applies). Used in the tooltip so the user can see
  // the provider's own range for that reading.
  refLow: number | null;
  refHigh: number | null;
}

export function pointKey(
  p: Pick<MetricChartPoint, "reportId" | "provider" | "timestamp">,
): string {
  return `${p.reportId}-${p.provider}-${p.timestamp}`;
}
