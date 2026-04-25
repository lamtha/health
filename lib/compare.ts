import "server-only";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  canonicalMetrics as canonicalMetricsTable,
  metrics as metricsTable,
  reports,
} from "@/db/schema";
import { canonicalUnit } from "@/lib/units";

export interface ComparePoint {
  reportId: number;
  provider: string;
  date: string;
  timestamp: number;
  value: number;
  units: string | null;
  flag: "high" | "low" | "ok" | null;
}

export interface CompareSeries {
  canonicalMetricId: number;
  canonicalName: string;
  category: string;
  tags: string[];
  units: string | null;
  unitsMismatch: boolean;
  refLow: number | null;
  refHigh: number | null;
  points: ComparePoint[];
  providers: string[];
  latest: ComparePoint | null;
  latestFlag: "high" | "low" | "ok" | null;
  // Rows that exist for this canonical but can't be plotted because the
  // provider reported a non-numeric value (e.g. "<dl", "Not Detected").
  nonNumericCount: number;
}

export interface CompareResult {
  series: CompareSeries[];
  // Shared time domain — union of every series' point timestamps.
  domainStart: number | null;
  domainEnd: number | null;
}

function parseFlag(v: string | null): "high" | "low" | "ok" | null {
  return v === "high" || v === "low" || v === "ok" ? v : null;
}

function coerceTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === "string");
  if (typeof raw === "string" && raw.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((t): t is string => typeof t === "string")
        : [];
    } catch {
      return [];
    }
  }
  return [];
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

export function getCompareSeries(canonicalIds: number[]): CompareResult {
  if (canonicalIds.length === 0) {
    return { series: [], domainStart: null, domainEnd: null };
  }

  const canonicalRows = db
    .select({
      id: canonicalMetricsTable.id,
      canonicalName: canonicalMetricsTable.canonicalName,
      category: canonicalMetricsTable.category,
      tags: canonicalMetricsTable.tags,
      preferredUnits: canonicalMetricsTable.preferredUnits,
    })
    .from(canonicalMetricsTable)
    .where(inArray(canonicalMetricsTable.id, canonicalIds))
    .all();

  const canonicalById = new Map<number, (typeof canonicalRows)[number]>();
  for (const c of canonicalRows) canonicalById.set(c.id, c);

  const metricRows = db
    .select({
      canonicalMetricId: metricsTable.canonicalMetricId,
      reportId: metricsTable.reportId,
      valueNumeric: metricsTable.valueNumeric,
      units: metricsTable.units,
      refLow: metricsTable.refLow,
      refHigh: metricsTable.refHigh,
      flag: metricsTable.flag,
      provider: reports.provider,
      reportDate: reports.reportDate,
    })
    .from(metricsTable)
    .innerJoin(reports, eq(metricsTable.reportId, reports.id))
    .where(inArray(metricsTable.canonicalMetricId, canonicalIds))
    .all();

  const byCanonical = new Map<number, (typeof metricRows)>();
  for (const r of metricRows) {
    if (r.canonicalMetricId == null) continue;
    let list = byCanonical.get(r.canonicalMetricId);
    if (!list) {
      list = [];
      byCanonical.set(r.canonicalMetricId, list);
    }
    list.push(r);
  }

  // Preserve caller-requested order so the UI matches the URL.
  const series: CompareSeries[] = [];
  let minTs: number | null = null;
  let maxTs: number | null = null;
  for (const id of canonicalIds) {
    const canonical = canonicalById.get(id);
    if (!canonical) continue;
    const rows = byCanonical.get(id) ?? [];

    const raw: ComparePoint[] = [];
    let nonNumericCount = 0;
    for (const r of rows) {
      if (r.valueNumeric == null) {
        nonNumericCount += 1;
        continue;
      }
      if (!r.reportDate) continue;
      const ts = Date.parse(r.reportDate);
      if (Number.isNaN(ts)) continue;
      raw.push({
        reportId: r.reportId,
        provider: r.provider,
        date: r.reportDate,
        timestamp: ts,
        value: r.valueNumeric,
        units: r.units,
        flag: parseFlag(r.flag),
      });
    }
    raw.sort((a, b) => a.timestamp - b.timestamp);

    // Drop rows whose canonical units disagree with the dominant canonical unit.
    const canonicalUnits = raw.map((p) => canonicalUnit(p.units));
    const dominantCanonical = pickDominant(canonicalUnits);
    const unitsMismatch =
      new Set(canonicalUnits.filter((u): u is string => u != null)).size > 1;
    const points = raw.filter(
      (p) => canonicalUnit(p.units) === dominantCanonical,
    );

    const unitsDisplay = pickDominant(points.map((p) => p.units));

    const providers = Array.from(new Set(points.map((p) => p.provider)));

    const refLows = rows
      .map((r) => r.refLow)
      .filter((v): v is number => v != null);
    const refHighs = rows
      .map((r) => r.refHigh)
      .filter((v): v is number => v != null);
    const refLow = refLows.length ? pickDominant(refLows) : null;
    const refHigh = refHighs.length ? pickDominant(refHighs) : null;

    const latest = points.length ? points[points.length - 1] : null;

    for (const p of points) {
      if (minTs === null || p.timestamp < minTs) minTs = p.timestamp;
      if (maxTs === null || p.timestamp > maxTs) maxTs = p.timestamp;
    }

    series.push({
      canonicalMetricId: canonical.id,
      canonicalName: canonical.canonicalName,
      category: canonical.category,
      tags: coerceTags(canonical.tags),
      units: unitsDisplay ?? canonical.preferredUnits,
      unitsMismatch,
      refLow,
      refHigh,
      points,
      providers,
      latest,
      latestFlag: latest?.flag ?? null,
      nonNumericCount,
    });
  }

  return { series, domainStart: minTs, domainEnd: maxTs };
}

export interface CompareCanonicalOption {
  id: number;
  canonicalName: string;
  category: string;
  metricRowCount: number;
}

// Canonical metrics that actually have data, for the +Metric picker.
// A canonical with zero metric rows isn't useful to chart.
export function getCompareCandidates(): CompareCanonicalOption[] {
  const withCounts = db
    .select({
      id: canonicalMetricsTable.id,
      canonicalName: canonicalMetricsTable.canonicalName,
      category: canonicalMetricsTable.category,
      count: metricsTable.id,
    })
    .from(canonicalMetricsTable)
    .innerJoin(
      metricsTable,
      eq(metricsTable.canonicalMetricId, canonicalMetricsTable.id),
    )
    .all();

  const byId = new Map<number, CompareCanonicalOption>();
  for (const r of withCounts) {
    const existing = byId.get(r.id);
    if (existing) {
      existing.metricRowCount += 1;
    } else {
      byId.set(r.id, {
        id: r.id,
        canonicalName: r.canonicalName,
        category: r.category,
        metricRowCount: 1,
      });
    }
  }
  return [...byId.values()].sort((a, b) =>
    a.canonicalName.localeCompare(b.canonicalName),
  );
}
