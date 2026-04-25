"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Dot,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Flag } from "@/components/health/flag";
import { overlayPrimitives } from "@/components/health/overlay";
import { cn } from "@/lib/utils";
import {
  assignProviderColors,
  providerDisplayName,
  type ProviderColor,
} from "@/lib/providers";
import type { OverlayBand, OverlayMarker } from "@/lib/overlays";
import {
  pointKey,
  type MetricChartPoint,
} from "@/components/health/metric-chart-types";

export {
  pointKey,
  type MetricChartPoint,
} from "@/components/health/metric-chart-types";

interface Props {
  metricName: string;
  units: string | null;
  points: MetricChartPoint[];
  providers: string[];
  refLow: number | null;
  refHigh: number | null;
  refLowVaries: boolean;
  refHighVaries: boolean;
  bands?: OverlayBand[];
  markers?: OverlayMarker[];
  // Externally-driven hover key (e.g. the raw-values table row the user is
  // hovering). When set, the matching dot renders an active-style halo so the
  // user can locate the reading on the timeline.
  externalHoveredKey?: string | null;
}

type Range = "1y" | "2y" | "5y" | "all";

const RANGES: { label: string; value: Range; days: number | null }[] = [
  { label: "1Y", value: "1y", days: 365 },
  { label: "2Y", value: "2y", days: 365 * 2 },
  { label: "5Y", value: "5y", days: 365 * 5 },
  { label: "All", value: "all", days: null },
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function formatDateTick(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function formatDateFull(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function MetricChart({
  metricName,
  units,
  points,
  providers,
  refLow,
  refHigh,
  refLowVaries,
  refHighVaries,
  bands = [],
  markers = [],
  externalHoveredKey = null,
}: Props) {
  const colors = useMemo(() => assignProviderColors(providers), [providers]);
  const [range, setRange] = useState<Range>("all");
  const [disabled, setDisabled] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    if (range === "all") return points;
    const spec = RANGES.find((r) => r.value === range);
    if (!spec?.days) return points;
    const cutoff = Date.now() - spec.days * MS_PER_DAY;
    return points.filter((p) => p.timestamp >= cutoff);
  }, [points, range]);

  const visiblePoints = useMemo(
    () => filtered.filter((p) => !disabled.has(p.provider)),
    [filtered, disabled],
  );

  // Build a single array keyed by timestamp, with one field per provider.
  const chartData = useMemo(() => {
    const byTs = new Map<number, Record<string, number | string>>();
    for (const p of filtered) {
      const row = byTs.get(p.timestamp) ?? { timestamp: p.timestamp };
      row[p.provider] = p.value;
      byTs.set(p.timestamp, row);
    }
    return Array.from(byTs.values()).sort(
      (a, b) => Number(a.timestamp) - Number(b.timestamp),
    );
  }, [filtered]);

  const { yDomain, xDomain } = useMemo(() => {
    const values = visiblePoints.map((p) => p.value);
    const refs = [refLow, refHigh].filter((v): v is number => v != null);
    const all = values.concat(refs);
    const lo = all.length ? Math.min(...all) : 0;
    const hi = all.length ? Math.max(...all) : 1;
    const span = Math.max(hi - lo, Math.abs(hi) * 0.1, 1);
    const pad = span * 0.15;
    const timestamps = filtered.map((p) => p.timestamp);
    let xLo = timestamps.length ? Math.min(...timestamps) : Date.now();
    let xHi = timestamps.length ? Math.max(...timestamps) : Date.now();
    if (xLo === xHi) {
      xLo -= 30 * MS_PER_DAY;
      xHi += 30 * MS_PER_DAY;
    } else {
      const xPad = (xHi - xLo) * 0.04;
      xLo -= xPad;
      xHi += xPad;
    }
    return {
      yDomain: [lo - pad, hi + pad] as [number, number],
      xDomain: [xLo, xHi] as [number, number],
    };
  }, [visiblePoints, filtered, refLow, refHigh]);

  function toggle(provider: string) {
    setDisabled((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  }

  const hasRefBand = refLow != null && refHigh != null;

  return (
    <Card className="overflow-hidden py-0">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
        <LabLegend
          providers={providers}
          colors={colors}
          disabled={disabled}
          onToggle={toggle}
        />
        <RangeToggle value={range} onChange={setRange} />
      </CardHeader>

      <div className="px-2 pt-4 pb-2">
        {visiblePoints.length === 0 ? (
          <div className="flex h-[340px] items-center justify-center text-[13px] text-muted-foreground">
            No measurements in this range.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={340}>
            <LineChart
              data={chartData}
              margin={{ top: 16, right: 24, left: 0, bottom: 8 }}
            >
              <CartesianGrid
                stroke="hsl(var(--chart-grid))"
                strokeWidth={1}
                vertical={false}
              />
              {overlayPrimitives({
                bands,
                markers,
                domainEnd: xDomain[1],
              })}
              {hasRefBand && (
                <ReferenceArea
                  y1={refLow!}
                  y2={refHigh!}
                  fill="hsl(var(--chart-ref))"
                  fillOpacity={0.07}
                  stroke="none"
                  ifOverflow="extendDomain"
                />
              )}
              {refLow != null && (
                <ReferenceLine
                  y={refLow}
                  stroke="hsl(var(--chart-ref))"
                  strokeOpacity={0.5}
                  strokeDasharray="4 4"
                  strokeWidth={1}
                />
              )}
              {refHigh != null && (
                <ReferenceLine
                  y={refHigh}
                  stroke="hsl(var(--chart-ref))"
                  strokeOpacity={0.5}
                  strokeDasharray="4 4"
                  strokeWidth={1}
                />
              )}
              <XAxis
                dataKey="timestamp"
                type="number"
                scale="time"
                domain={xDomain}
                tickFormatter={formatDateTick}
                tick={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  fill: "hsl(var(--muted-foreground))",
                }}
                tickLine={false}
                axisLine={{ stroke: "hsl(var(--border))" }}
                minTickGap={40}
              />
              <YAxis
                type="number"
                domain={yDomain}
                tick={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  fill: "hsl(var(--muted-foreground))",
                }}
                tickLine={false}
                axisLine={false}
                width={48}
              />
              <Tooltip
                cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }}
                content={
                  <MetricTooltip
                    units={units}
                    colors={colors}
                    pointsByTs={filtered}
                  />
                }
              />
              {providers.map((provider) => {
                if (disabled.has(provider)) return null;
                const color = colors.get(provider);
                const stroke = color ? `hsl(${color.hsl})` : "hsl(240 4% 46%)";
                return (
                  <Line
                    key={provider}
                    type="linear"
                    dataKey={provider}
                    stroke={stroke}
                    strokeWidth={1.5}
                    connectNulls
                    isAnimationActive={false}
                    dot={(props) => (
                      <MetricDot
                        key={`dot-${props.index}`}
                        {...props}
                        stroke={stroke}
                        flagLookup={filtered}
                        provider={provider}
                        externalHoveredKey={externalHoveredKey}
                      />
                    )}
                    activeDot={{
                      r: 5,
                      stroke,
                      strokeWidth: 2,
                      fill: "hsl(var(--background))",
                    }}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3 font-mono text-[11px] text-muted-foreground">
        <span>
          {points.length > 0
            ? `${points[0].date} → ${points[points.length - 1].date}`
            : "—"}
        </span>
        <span>
          {visiblePoints.length} measurement
          {visiblePoints.length === 1 ? "" : "s"} · {providers.length} provider
          {providers.length === 1 ? "" : "s"}
          {(refLowVaries || refHighVaries) && (
            <span className="ml-2 text-flag-high">
              · reference ranges vary across providers
            </span>
          )}
        </span>
      </div>

      <div className="sr-only" aria-live="polite">
        Showing {metricName} over {range} range.
      </div>
    </Card>
  );
}

interface DotProps {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: Record<string, number | string>;
  stroke: string;
  provider: string;
  flagLookup: MetricChartPoint[];
  externalHoveredKey?: string | null;
}

function MetricDot({
  cx,
  cy,
  payload,
  stroke,
  provider,
  flagLookup,
  externalHoveredKey,
}: DotProps) {
  if (cx == null || cy == null || !payload) return null;
  const ts = Number(payload.timestamp);
  const p = flagLookup.find(
    (pt) => pt.timestamp === ts && pt.provider === provider,
  );
  const flag = p?.flag ?? null;
  const haloFill =
    flag === "high"
      ? "hsl(var(--flag-high) / 0.18)"
      : flag === "low"
        ? "hsl(var(--flag-low) / 0.18)"
        : null;
  const isExternallyHovered = p != null && externalHoveredKey === pointKey(p);
  return (
    <g>
      {haloFill && <circle cx={cx} cy={cy} r={9} fill={haloFill} />}
      {isExternallyHovered && (
        <circle
          cx={cx}
          cy={cy}
          r={9}
          fill="none"
          stroke={stroke}
          strokeWidth={2}
          strokeOpacity={0.85}
        />
      )}
      <Dot
        cx={cx}
        cy={cy}
        r={isExternallyHovered ? 5 : 4}
        fill={stroke}
        stroke="hsl(var(--background))"
        strokeWidth={1.5}
      />
    </g>
  );
}

interface TooltipExtras {
  units: string | null;
  colors: Map<string, ProviderColor>;
  pointsByTs: MetricChartPoint[];
}

interface RechartsTooltipEntry {
  dataKey?: string | number;
  value?: number | string;
  color?: string;
}

interface RechartsTooltipProps {
  active?: boolean;
  payload?: RechartsTooltipEntry[];
  label?: string | number;
}

function MetricTooltip({
  active,
  payload,
  label,
  units,
  colors,
  pointsByTs,
}: RechartsTooltipProps & TooltipExtras) {
  if (!active || !payload || payload.length === 0) return null;
  const ts = Number(label);
  const hits = payload
    .map((entry: RechartsTooltipEntry) => {
      const provider = String(entry.dataKey);
      const pt = pointsByTs.find(
        (p) => p.timestamp === ts && p.provider === provider,
      );
      return pt;
    })
    .filter((pt: MetricChartPoint | undefined): pt is MetricChartPoint => pt != null);

  if (hits.length === 0) return null;

  const unitLabel = units ? ` ${units}` : "";
  return (
    <div className="rounded-md border border-border bg-background p-2.5 shadow-md">
      <div className="mb-1.5 font-mono text-[11px] text-muted-foreground">
        {formatDateFull(ts)}
      </div>
      <div className="space-y-1.5">
        {hits.map((p) => {
          const color = colors.get(p.provider);
          const hasRef = p.refLow != null || p.refHigh != null;
          return (
            <div key={p.provider} className="text-[12.5px]">
              <div className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: color ? `hsl(${color.hsl})` : undefined,
                  }}
                />
                <span className="font-medium text-foreground">
                  {providerDisplayName(p.provider)}
                </span>
                <span className="ml-auto font-mono tabular-nums text-foreground">
                  {p.value}
                  {unitLabel}
                </span>
                {p.flag && p.flag !== "ok" && (
                  <span
                    className={cn(
                      "font-mono text-[10px] uppercase",
                      p.flag === "high" ? "text-flag-high" : "text-flag-low",
                    )}
                  >
                    {p.flag}
                  </span>
                )}
              </div>
              {hasRef && (
                <div className="pl-4 font-mono text-[10.5px] text-muted-foreground">
                  ref{" "}
                  {p.refLow != null ? formatTooltipValue(p.refLow) : "—"}
                  {" – "}
                  {p.refHigh != null ? formatTooltipValue(p.refHigh) : "—"}
                  {unitLabel}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatTooltipValue(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 100 && Number.isInteger(v)) return v.toString();
  return Number(v.toFixed(3)).toString();
}

function LabLegend({
  providers,
  colors,
  disabled,
  onToggle,
}: {
  providers: string[];
  colors: Map<string, ProviderColor>;
  disabled: Set<string>;
  onToggle: (p: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px]">
      {providers.map((p) => {
        const color = colors.get(p);
        const off = disabled.has(p);
        return (
          <button
            type="button"
            key={p}
            onClick={() => onToggle(p)}
            className={cn(
              "group inline-flex items-center gap-2 rounded-md px-1.5 py-1 transition-opacity hover:bg-muted/60",
              off && "opacity-40",
            )}
            aria-pressed={!off}
          >
            <span
              className="inline-block h-[2px] w-5 rounded-full"
              style={{
                backgroundColor: color ? `hsl(${color.hsl})` : undefined,
              }}
            />
            <span className="font-medium text-foreground">
              {providerDisplayName(p)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function RangeToggle({
  value,
  onChange,
}: {
  value: Range;
  onChange: (r: Range) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5">
      {RANGES.map((r) => (
        <Button
          key={r.value}
          type="button"
          size="xs"
          variant={value === r.value ? "default" : "ghost"}
          onClick={() => onChange(r.value)}
          className={cn(
            "h-6 min-w-[34px] font-mono text-[11px]",
            value !== r.value && "text-muted-foreground",
          )}
        >
          {r.label}
        </Button>
      ))}
    </div>
  );
}

export { Flag };
