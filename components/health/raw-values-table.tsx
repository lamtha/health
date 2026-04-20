"use client";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Flag } from "@/components/health/flag";
import { pointKey, type MetricChartPoint } from "@/components/health/metric-chart";
import { cn } from "@/lib/utils";
import {
  assignProviderColors,
  providerDisplayName,
} from "@/lib/providers";

// Row shape — matches MetricChartPoint plus the original-value fields from
// lib/metric-series. Kept as a structural interface so page code can pass the
// MetricPoint type straight through without a conversion step.
export interface RawValuePoint extends MetricChartPoint {
  originalValue: number;
  originalRefLow: number | null;
  originalRefHigh: number | null;
  uploadedAt: string;
}

interface Props {
  points: RawValuePoint[];
  providers: string[];
  excludedKeys: Set<string>;
  onRowHover?: (key: string | null) => void;
}

function formatValue(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 100 && Number.isInteger(v)) return v.toString();
  return Number(v.toFixed(3)).toString();
}

export function RawValuesTable({
  points,
  providers,
  excludedKeys,
  onRowHover,
}: Props) {
  const colors = assignProviderColors(providers);
  const pointsNewestFirst = [...points].reverse();

  return (
    <Card className="py-0">
      <CardHeader className="border-b px-5 py-3">
        <CardTitle className="text-[13px]">
          Raw values · {points.length} observation
          {points.length === 1 ? "" : "s"}
        </CardTitle>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">Date</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead className="text-right">Units</TableHead>
            <TableHead className="text-right">Flag</TableHead>
            <TableHead className="pr-5 text-right">Range</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pointsNewestFirst.map((p) => {
            const color = colors.get(p.provider);
            const rowKey = pointKey(p);
            const isExcluded = excludedKeys.has(rowKey);
            return (
              <TableRow
                key={rowKey}
                className={cn(
                  "transition-colors",
                  isExcluded && "opacity-60",
                  onRowHover && "cursor-default hover:bg-muted/60",
                )}
                onMouseEnter={
                  onRowHover && !isExcluded
                    ? () => onRowHover(rowKey)
                    : undefined
                }
                onMouseLeave={
                  onRowHover && !isExcluded
                    ? () => onRowHover(null)
                    : undefined
                }
              >
                <TableCell className="pl-5 font-mono text-[12px] text-muted-foreground">
                  {p.date}
                </TableCell>
                <TableCell
                  className="text-[13px] font-medium"
                  style={{
                    color: color ? `hsl(${color.hsl})` : undefined,
                  }}
                >
                  {providerDisplayName(p.provider)}
                </TableCell>
                <TableCell className="text-right font-mono text-[13px] font-medium">
                  {formatValue(p.originalValue)}
                </TableCell>
                <TableCell className="text-right font-mono text-[11.5px] text-muted-foreground">
                  {p.units ?? "—"}
                </TableCell>
                <TableCell className="text-right">
                  {isExcluded ? (
                    <span className="font-mono text-[10px] uppercase text-muted-foreground">
                      not charted
                    </span>
                  ) : (
                    <Flag flag={p.flag} />
                  )}
                </TableCell>
                <TableCell className="pr-5 text-right font-mono text-[11.5px] text-muted-foreground">
                  {p.originalRefLow != null || p.originalRefHigh != null
                    ? `${p.originalRefLow != null ? formatValue(p.originalRefLow) : "—"} – ${
                        p.originalRefHigh != null ? formatValue(p.originalRefHigh) : "—"
                      }`
                    : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
