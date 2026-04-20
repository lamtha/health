"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Flag } from "@/components/health/flag";
import { overlayPrimitives } from "@/components/health/overlay";
import type { CompareSeries } from "@/lib/compare";
import type { OverlayBand, OverlayMarker } from "@/lib/overlays";

interface CompareChartProps {
  series: CompareSeries;
  domainStart: number;
  domainEnd: number;
  // Hue index 0..N used to pick a chart color from CSS tokens.
  colorIndex: number;
  bands: OverlayBand[];
  markers: OverlayMarker[];
}

// Curated palette matching ./design/shadcn/theme.css semantics. These
// are concrete HSL values rather than CSS tokens so Recharts can draw
// reliably in SVG (token resolution depends on inheritance that doesn't
// reach Recharts primitives).
const PALETTE = [
  "hsl(240 10% 9%)",
  "hsl(0 72% 51%)",
  "hsl(217 91% 60%)",
  "hsl(36 80% 50%)",
];

export function CompareChart({
  series,
  domainStart,
  domainEnd,
  colorIndex,
  bands,
  markers,
}: CompareChartProps) {
  const color = PALETTE[colorIndex % PALETTE.length];

  const data = series.points.map((p) => ({
    timestamp: p.timestamp,
    date: p.date,
    value: p.value,
    provider: p.provider,
    flag: p.flag,
  }));

  // Y domain: span of values + reference range, with small padding.
  const valueVals = data.map((d) => d.value);
  const refCandidates: number[] = [];
  if (series.refLow != null) refCandidates.push(series.refLow);
  if (series.refHigh != null) refCandidates.push(series.refHigh);
  const allY = [...valueVals, ...refCandidates];
  const minY = allY.length ? Math.min(...allY) : 0;
  const maxY = allY.length ? Math.max(...allY) : 1;
  const pad = (maxY - minY) * 0.12 || 1;

  const formatValue = (v: number) =>
    Number.isFinite(v)
      ? Math.abs(v) >= 100 && Number.isInteger(v)
        ? v.toString()
        : Number(v.toFixed(2)).toString()
      : "—";

  return (
    <Card className="overflow-hidden py-0">
      <CardHeader className="flex flex-row items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <CardTitle className="font-serif-display truncate text-[18px] leading-tight">
            {series.canonicalName}
          </CardTitle>
          <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
            {series.units ?? "—"} · {series.points.length} obs ·{" "}
            {series.providers.length} provider
            {series.providers.length === 1 ? "" : "s"}
            {series.unitsMismatch && <span className="ml-1 text-flag-high">· units vary</span>}
          </div>
        </div>
        <div className="shrink-0">
          <Flag flag={series.latestFlag} />
        </div>
      </CardHeader>
      <div className="p-2" style={{ height: 160 }}>
        {data.length === 0 ? (
          <div className="grid h-full place-items-center text-[12px] text-muted-foreground">
            No numeric data
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="hsl(0 0% 90%)" strokeOpacity={0.7} vertical={false} />
              <XAxis
                dataKey="timestamp"
                type="number"
                scale="time"
                domain={[domainStart, domainEnd]}
                tickFormatter={(t: number) =>
                  new Date(t).toLocaleDateString("en-US", {
                    month: "short",
                    year: "2-digit",
                  })
                }
                tick={{ fontSize: 10, fill: "hsl(0 0% 45%)" }}
                axisLine={{ stroke: "hsl(0 0% 80%)" }}
                tickLine={{ stroke: "hsl(0 0% 80%)" }}
              />
              <YAxis
                domain={[minY - pad, maxY + pad]}
                tick={{ fontSize: 10, fill: "hsl(0 0% 45%)" }}
                axisLine={false}
                tickLine={false}
                width={44}
                tickFormatter={(v: number) => formatValue(v)}
              />
              {overlayPrimitives({ bands, markers, domainEnd })}
              {series.refLow != null && series.refHigh != null && (
                <ReferenceArea
                  y1={series.refLow}
                  y2={series.refHigh}
                  fill="hsla(160 84% 39% / 0.08)"
                  strokeOpacity={0}
                />
              )}
              {series.refLow != null && (
                <ReferenceLine
                  y={series.refLow}
                  stroke="hsla(160 84% 39% / 0.5)"
                  strokeDasharray="3 3"
                />
              )}
              {series.refHigh != null && (
                <ReferenceLine
                  y={series.refHigh}
                  stroke="hsla(160 84% 39% / 0.5)"
                  strokeDasharray="3 3"
                />
              )}
              <Tooltip
                cursor={{ stroke: "hsl(0 0% 60%)", strokeDasharray: "4 4" }}
                contentStyle={{
                  background: "hsl(0 0% 100%)",
                  border: "1px solid hsl(0 0% 85%)",
                  borderRadius: 6,
                  fontSize: 12,
                }}
                formatter={(value) => [
                  `${formatValue(typeof value === "number" ? value : Number(value))}${series.units ? ` ${series.units}` : ""}`,
                  series.canonicalName,
                ]}
                labelFormatter={(label) => {
                  const t = typeof label === "number" ? label : Number(label);
                  if (!Number.isFinite(t)) return "";
                  return new Date(t).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  });
                }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={1.5}
                dot={{ r: 2.5, fill: color, strokeWidth: 0 }}
                activeDot={{ r: 4, fill: color }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

export { PALETTE as COMPARE_PALETTE };
