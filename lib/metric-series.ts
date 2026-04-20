import "server-only";

import { eq, or } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  canonicalMetrics as canonicalMetricsTable,
  metrics as metricsTable,
  reports,
} from "@/db/schema";
import { canonicalUnit } from "@/lib/units";

export interface MetricPoint {
  reportId: number;
  provider: string;
  date: string;
  timestamp: number;
  value: number;
  units: string | null;
  flag: "high" | "low" | "ok" | null;
  refLow: number | null;
  refHigh: number | null;
  uploadedAt: string;
}

export interface MetricConflict {
  date: string;
  kept: { value: number; reportId: number; provider: string };
  discarded: Array<{
    value: number;
    reportId: number;
    provider: string;
    uploadedAt: string;
  }>;
}

export interface MetricSeriesResult {
  name: string;
  canonicalMetricId: number | null;
  rawNames: string[]; // every distinct raw name that contributed rows (for canonical groups)
  units: string | null;
  unitsAll: string[];
  unitsMismatch: boolean;
  excludedForUnits: MetricPoint[];
  points: MetricPoint[];
  providers: string[];
  refLow: number | null;
  refHigh: number | null;
  refLowVaries: boolean;
  refHighVaries: boolean;
  category: string | null;
  latest: MetricPoint | null;
  mean: number | null;
  min: number | null;
  max: number | null;
  duplicatesCollapsed: number;
  conflicts: MetricConflict[];
}

function parseFlag(v: string | null): "high" | "low" | "ok" | null {
  return v === "high" || v === "low" || v === "ok" ? v : null;
}

function normalizeUnits(u: string | null): string | null {
  if (!u) return null;
  const t = u.trim();
  return t === "" ? null : t;
}

function pickDominant<T>(values: T[]): T | null {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  let bestN = -1;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

export function getMetricSeries(name: string): MetricSeriesResult | null {
  // Try canonical-name lookup first. A canonical match aggregates rows
  // across every alias (e.g. "WBC" and "Leukocytes" both surface under
  // "White Blood Cells"). Fall back to exact raw-name match when no
  // canonical matches — older unmapped metrics still resolve.
  const canonical = db
    .select({
      id: canonicalMetricsTable.id,
      canonicalName: canonicalMetricsTable.canonicalName,
      category: canonicalMetricsTable.category,
    })
    .from(canonicalMetricsTable)
    .where(eq(canonicalMetricsTable.canonicalName, name))
    .get();

  const whereClause = canonical
    ? or(
        eq(metricsTable.canonicalMetricId, canonical.id),
        // Rows that name-match as well — lets /metric/<canonical> catch
        // pre-canonicalization stragglers if any still exist.
        eq(metricsTable.name, name),
      )
    : eq(metricsTable.name, name);

  const rows = db
    .select({
      reportId: metricsTable.reportId,
      metricName: metricsTable.name,
      valueNumeric: metricsTable.valueNumeric,
      units: metricsTable.units,
      refLow: metricsTable.refLow,
      refHigh: metricsTable.refHigh,
      flag: metricsTable.flag,
      provider: reports.provider,
      category: reports.category,
      reportDate: reports.reportDate,
      uploadedAt: reports.uploadedAt,
    })
    .from(metricsTable)
    .innerJoin(reports, eq(metricsTable.reportId, reports.id))
    .where(whereClause)
    .all();

  if (rows.length === 0) return null;

  const category = canonical?.category ?? rows[0]?.category ?? null;
  const displayName = canonical?.canonicalName ?? name;
  const rawNames = Array.from(new Set(rows.map((r) => r.metricName))).sort();

  const allRaw: MetricPoint[] = [];
  for (const r of rows) {
    if (r.valueNumeric == null || !r.reportDate) continue;
    const ts = Date.parse(r.reportDate);
    if (Number.isNaN(ts)) continue;
    allRaw.push({
      reportId: r.reportId,
      provider: r.provider,
      date: r.reportDate,
      timestamp: ts,
      value: r.valueNumeric,
      units: normalizeUnits(r.units),
      flag: parseFlag(r.flag),
      refLow: r.refLow ?? null,
      refHigh: r.refHigh ?? null,
      uploadedAt: r.uploadedAt,
    });
  }

  allRaw.sort((a, b) => a.timestamp - b.timestamp);

  const unitsAll = Array.from(
    new Set(allRaw.map((p) => p.units).filter((u): u is string => u != null)),
  ).sort();

  const canonicalAll = Array.from(
    new Set(
      allRaw.map((p) => canonicalUnit(p.units)).filter((u): u is string => u != null),
    ),
  );
  const unitsMismatch = canonicalAll.length > 1;
  const dominantCanonical = pickDominant(allRaw.map((p) => canonicalUnit(p.units)));

  if (unitsMismatch) {
    console.warn(
      `[metric-series] Unmapped unit collision for "${name}": canonical groups=[${canonicalAll.join(", ")}] raw=[${unitsAll.join(", ")}]. Consider adding to UNIT_ALIASES.`,
    );
  }

  const keptByUnit = unitsMismatch
    ? allRaw.filter((p) => canonicalUnit(p.units) === dominantCanonical)
    : allRaw;
  const excludedForUnits = unitsMismatch
    ? allRaw.filter((p) => canonicalUnit(p.units) !== dominantCanonical)
    : [];

  // Cross-report dedupe within the kept unit bucket. Group by report date:
  // if multiple points share a date, a later report restated an earlier
  // result (or the same collection was re-reported). Same value → collapse
  // silently. Different values → conflict; keep the most recently uploaded
  // report's value so a corrected revision wins over the original.
  const byDate = new Map<string, MetricPoint[]>();
  for (const p of keptByUnit) {
    const group = byDate.get(p.date) ?? [];
    group.push(p);
    byDate.set(p.date, group);
  }
  const points: MetricPoint[] = [];
  const conflicts: MetricConflict[] = [];
  let duplicatesCollapsed = 0;
  for (const group of byDate.values()) {
    if (group.length === 1) {
      points.push(group[0]);
      continue;
    }
    const sorted = [...group].sort((a, b) =>
      b.uploadedAt.localeCompare(a.uploadedAt),
    );
    const kept = sorted[0];
    const others = sorted.slice(1);
    const distinct = new Set(group.map((p) => p.value));
    if (distinct.size === 1) {
      duplicatesCollapsed += others.length;
    } else {
      conflicts.push({
        date: kept.date,
        kept: {
          value: kept.value,
          reportId: kept.reportId,
          provider: kept.provider,
        },
        discarded: others.map((o) => ({
          value: o.value,
          reportId: o.reportId,
          provider: o.provider,
          uploadedAt: o.uploadedAt,
        })),
      });
      console.warn(
        `[metric-series] Conflict for "${name}" on ${kept.date}: keeping ${kept.value} from report ${kept.reportId} (uploaded ${kept.uploadedAt}); discarded ${others
          .map((o) => `${o.value} (report ${o.reportId}, uploaded ${o.uploadedAt})`)
          .join(", ")}.`,
      );
    }
    points.push(kept);
  }
  points.sort((a, b) => a.timestamp - b.timestamp);

  // Display unit: the most common raw form within the kept bucket, so the
  // label on the chart matches what the lab actually printed.
  const dominant = pickDominant(points.map((p) => p.units));

  const providers = Array.from(new Set(points.map((p) => p.provider)));

  const refLows = points.map((p) => p.refLow).filter((v): v is number => v != null);
  const refHighs = points.map((p) => p.refHigh).filter((v): v is number => v != null);
  const refLow = refLows.length ? pickDominant(refLows) : null;
  const refHigh = refHighs.length ? pickDominant(refHighs) : null;
  const refLowVaries = new Set(refLows).size > 1;
  const refHighVaries = new Set(refHighs).size > 1;

  const latest = points.length ? points[points.length - 1] : null;
  const values = points.map((p) => p.value);
  const mean = values.length
    ? values.reduce((a, b) => a + b, 0) / values.length
    : null;
  const min = values.length ? Math.min(...values) : null;
  const max = values.length ? Math.max(...values) : null;

  return {
    name: displayName,
    canonicalMetricId: canonical?.id ?? null,
    rawNames,
    units: dominant ?? null,
    unitsAll,
    unitsMismatch,
    excludedForUnits,
    points,
    providers,
    refLow,
    refHigh,
    refLowVaries,
    refHighVaries,
    category,
    latest,
    mean,
    min,
    max,
    duplicatesCollapsed,
    conflicts,
  };
}
