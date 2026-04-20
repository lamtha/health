import "server-only";

import { asc, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  canonicalMetrics as canonicalMetricsTable,
  metrics as metricsTable,
  reports,
} from "@/db/schema";

export interface DashboardMetric {
  // URL key used by /metric/[name]. Canonical name when mapped, else raw.
  name: string;
  rawName: string;
  canonicalMetricId: number | null;
  category: string;
  tags: string[];
  lastValue: number | null;
  lastValueText: string | null;
  lastUnits: string | null;
  lastReportDate: string | null;
  lastFlag: "high" | "low" | "ok" | null;
  reportCount: number;
  history: number[];
  trend: "up" | "down" | "flat";
}

export interface DashboardReportRow {
  id: number;
  reportDate: string | null;
  provider: string;
  category: string;
  metricCount: number;
}

export type MetricsFilter =
  | { kind: "all" }
  | { kind: "category"; slug: string }
  | { kind: "tag"; slug: string }
  | { kind: "unmapped" };

export interface DashboardSummary {
  filter: MetricsFilter;
  metricCount: number; // after filter
  flaggedCount: number; // after filter
  reportCount: number; // total (unfiltered)
  metrics: DashboardMetric[]; // after filter
  recentReports: DashboardReportRow[];
  // Counts of distinct metric groups per slug — unfiltered, feeds chip strip.
  categoryCounts: Record<string, number>;
  tagCounts: Record<string, number>;
  unmappedDistinctNames: number; // distinct unmapped raw names
  unmappedMetricRows: number; // unmapped metric rows total
}

function pickFlag(v: string | null): "high" | "low" | "ok" | null {
  if (v === "high" || v === "low" || v === "ok") return v;
  return null;
}

function computeTrend(hist: number[]): "up" | "down" | "flat" {
  if (hist.length < 2) return "flat";
  const last = hist[hist.length - 1];
  const prior = hist.slice(0, -1);
  const priorMean =
    prior.reduce((a, b) => a + b, 0) / Math.max(1, prior.length);
  if (!Number.isFinite(last) || !Number.isFinite(priorMean)) return "flat";
  const rel = Math.abs(priorMean) < 1e-9 ? 0 : (last - priorMean) / Math.abs(priorMean);
  if (rel > 0.05) return "up";
  if (rel < -0.05) return "down";
  return "flat";
}

// tags comes back from drizzle as a parsed JSON value when the column is
// declared with mode: "json". Defensively coerce in case of a stray raw
// string (e.g. a future schema change) — the cost is one runtime check
// that proves harmless even when tags is already an array.
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

export function resolveMetricsFilter(params: {
  cat?: string;
  tag?: string;
  unmapped?: string;
}): MetricsFilter {
  if (params.unmapped === "1" || params.unmapped === "true")
    return { kind: "unmapped" };
  if (params.cat && params.cat.trim()) return { kind: "category", slug: params.cat.trim() };
  if (params.tag && params.tag.trim()) return { kind: "tag", slug: params.tag.trim() };
  return { kind: "all" };
}

export function getDashboardSummary(filter: MetricsFilter = { kind: "all" }): DashboardSummary {
  const rows = db
    .select({
      metricId: metricsTable.id,
      metricName: metricsTable.name,
      valueNumeric: metricsTable.valueNumeric,
      valueText: metricsTable.valueText,
      units: metricsTable.units,
      flag: metricsTable.flag,
      reportId: metricsTable.reportId,
      canonicalMetricId: metricsTable.canonicalMetricId,
      reportDate: reports.reportDate,
      reportCategory: reports.category,
      canonicalName: canonicalMetricsTable.canonicalName,
      canonicalCategory: canonicalMetricsTable.category,
      canonicalTags: canonicalMetricsTable.tags,
    })
    .from(metricsTable)
    .innerJoin(reports, eq(metricsTable.reportId, reports.id))
    .leftJoin(
      canonicalMetricsTable,
      eq(metricsTable.canonicalMetricId, canonicalMetricsTable.id),
    )
    .all();

  interface Group {
    name: string;
    rawName: string;
    canonicalMetricId: number | null;
    category: string;
    tags: string[];
    rows: typeof rows;
  }

  const groups = new Map<string, Group>();
  for (const r of rows) {
    const tags = coerceTags(r.canonicalTags);
    const isMapped = r.canonicalMetricId != null && r.canonicalName != null;
    const key = isMapped
      ? `canonical:${r.canonicalMetricId}`
      : `raw:${r.metricName.trim().toLowerCase()}`;

    let group = groups.get(key);
    if (!group) {
      group = {
        name: isMapped ? r.canonicalName! : r.metricName,
        rawName: r.metricName,
        canonicalMetricId: r.canonicalMetricId,
        category: isMapped ? (r.canonicalCategory ?? r.reportCategory) : r.reportCategory,
        tags: isMapped ? tags : [],
        rows: [],
      };
      groups.set(key, group);
    }
    group.rows.push(r);
  }

  // Category + tag + unmapped counts — always computed on the full
  // unfiltered set so chips show stable totals regardless of the
  // currently-applied filter.
  const categoryCounts: Record<string, number> = {};
  const tagCounts: Record<string, number> = {};
  let unmappedDistinctNames = 0;
  for (const g of groups.values()) {
    if (g.canonicalMetricId == null) {
      unmappedDistinctNames += 1;
      continue;
    }
    categoryCounts[g.category] = (categoryCounts[g.category] ?? 0) + 1;
    for (const t of g.tags) {
      tagCounts[t] = (tagCounts[t] ?? 0) + 1;
    }
  }

  const filtered: Group[] = [];
  for (const g of groups.values()) {
    if (filter.kind === "all") {
      filtered.push(g);
    } else if (filter.kind === "unmapped") {
      if (g.canonicalMetricId == null) filtered.push(g);
    } else if (filter.kind === "category") {
      if (g.canonicalMetricId != null && g.category === filter.slug) filtered.push(g);
    } else if (filter.kind === "tag") {
      if (g.canonicalMetricId != null && g.tags.includes(filter.slug)) filtered.push(g);
    }
  }

  const metrics: DashboardMetric[] = filtered.map((g) => {
    const sorted = [...g.rows].sort((a, b) =>
      (a.reportDate ?? "").localeCompare(b.reportDate ?? ""),
    );
    const reportIds = new Set(sorted.map((r) => r.reportId));
    const numeric = sorted
      .map((r) => r.valueNumeric)
      .filter((v): v is number => typeof v === "number");
    const last = sorted[sorted.length - 1];
    return {
      name: g.name,
      rawName: g.rawName,
      canonicalMetricId: g.canonicalMetricId,
      category: g.category,
      tags: g.tags,
      lastValue: last.valueNumeric,
      lastValueText: last.valueText,
      lastUnits: last.units,
      lastReportDate: last.reportDate,
      lastFlag: pickFlag(last.flag),
      reportCount: reportIds.size,
      history: numeric,
      trend: computeTrend(numeric),
    };
  });

  metrics.sort((a, b) => {
    const aFlagged = a.lastFlag === "high" || a.lastFlag === "low" ? 0 : 1;
    const bFlagged = b.lastFlag === "high" || b.lastFlag === "low" ? 0 : 1;
    if (aFlagged !== bFlagged) return aFlagged - bFlagged;
    return b.reportCount - a.reportCount;
  });

  const flaggedCount = metrics.filter(
    (m) => m.lastFlag === "high" || m.lastFlag === "low",
  ).length;

  const recentReportsRaw = db
    .select({
      id: reports.id,
      reportDate: reports.reportDate,
      uploadedAt: reports.uploadedAt,
      provider: reports.provider,
      category: reports.category,
    })
    .from(reports)
    .orderBy(desc(reports.reportDate), desc(reports.uploadedAt))
    .limit(5)
    .all();

  const counts = db
    .select({
      reportId: metricsTable.reportId,
      count: metricsTable.id,
    })
    .from(metricsTable)
    .all();
  const countByReport = new Map<number, number>();
  for (const c of counts) {
    countByReport.set(c.reportId, (countByReport.get(c.reportId) ?? 0) + 1);
  }

  const recentReports: DashboardReportRow[] = recentReportsRaw.map((r) => ({
    id: r.id,
    reportDate: r.reportDate,
    provider: r.provider,
    category: r.category,
    metricCount: countByReport.get(r.id) ?? 0,
  }));

  const reportCountRow = db
    .select({ n: sql<number>`count(*)` })
    .from(reports)
    .get();

  const unmappedRowsRow = db
    .select({ total: sql<number>`count(*)` })
    .from(metricsTable)
    .where(isNull(metricsTable.canonicalMetricId))
    .get();

  return {
    filter,
    metricCount: metrics.length,
    flaggedCount,
    reportCount: reportCountRow?.n ?? 0,
    metrics,
    recentReports,
    categoryCounts,
    tagCounts,
    unmappedDistinctNames,
    unmappedMetricRows: unmappedRowsRow?.total ?? 0,
  };
}

export interface ReportListRow {
  id: number;
  reportDate: string | null;
  uploadedAt: string;
  provider: string;
  category: string;
  metricCount: number;
  flaggedCount: number;
}

export interface ReportListResult {
  rows: ReportListRow[];
  filter: MetricsFilter;
  categoryCounts: Record<string, number>;
  tagCounts: Record<string, number>;
  unmappedReportCount: number;
}

export function getAllReports(filter: MetricsFilter = { kind: "all" }): ReportListResult {
  // Two queries: one to get every report row; one to get every metric +
  // canonical to compute flag counts and the per-category/per-tag report
  // tallies. Both fit in-memory at our scale.
  const reportRows = db
    .select({
      id: reports.id,
      reportDate: reports.reportDate,
      uploadedAt: reports.uploadedAt,
      provider: reports.provider,
      category: reports.category,
    })
    .from(reports)
    .orderBy(desc(reports.reportDate), desc(reports.uploadedAt))
    .all();

  const metricAgg = db
    .select({
      reportId: metricsTable.reportId,
      flag: metricsTable.flag,
      canonicalMetricId: metricsTable.canonicalMetricId,
      canonicalCategory: canonicalMetricsTable.category,
      canonicalTags: canonicalMetricsTable.tags,
    })
    .from(metricsTable)
    .leftJoin(
      canonicalMetricsTable,
      eq(metricsTable.canonicalMetricId, canonicalMetricsTable.id),
    )
    .all();

  interface PerReport {
    total: number;
    flagged: number;
    categories: Set<string>;
    tags: Set<string>;
    hasUnmapped: boolean;
  }
  const perReport = new Map<number, PerReport>();
  for (const m of metricAgg) {
    let cur = perReport.get(m.reportId);
    if (!cur) {
      cur = { total: 0, flagged: 0, categories: new Set(), tags: new Set(), hasUnmapped: false };
      perReport.set(m.reportId, cur);
    }
    cur.total += 1;
    if (m.flag === "high" || m.flag === "low") cur.flagged += 1;
    if (m.canonicalMetricId == null) {
      cur.hasUnmapped = true;
    } else if (m.canonicalCategory) {
      cur.categories.add(m.canonicalCategory);
      for (const t of coerceTags(m.canonicalTags)) cur.tags.add(t);
    }
  }

  const categoryCounts: Record<string, number> = {};
  const tagCounts: Record<string, number> = {};
  let unmappedReportCount = 0;
  for (const r of perReport.values()) {
    for (const c of r.categories) {
      categoryCounts[c] = (categoryCounts[c] ?? 0) + 1;
    }
    for (const t of r.tags) {
      tagCounts[t] = (tagCounts[t] ?? 0) + 1;
    }
    if (r.hasUnmapped) unmappedReportCount += 1;
  }

  const matchesFilter = (r: PerReport): boolean => {
    if (filter.kind === "all") return true;
    if (filter.kind === "unmapped") return r.hasUnmapped;
    if (filter.kind === "category") return r.categories.has(filter.slug);
    if (filter.kind === "tag") return r.tags.has(filter.slug);
    return true;
  };

  const rows: ReportListRow[] = [];
  for (const r of reportRows) {
    const agg = perReport.get(r.id);
    if (!agg) continue; // reports without metrics — should be rare
    if (!matchesFilter(agg)) continue;
    rows.push({
      id: r.id,
      reportDate: r.reportDate,
      uploadedAt: r.uploadedAt,
      provider: r.provider,
      category: r.category,
      metricCount: agg.total,
      flaggedCount: agg.flagged,
    });
  }

  return {
    rows,
    filter,
    categoryCounts,
    tagCounts,
    unmappedReportCount,
  };
}

export interface UnmappedMetricRow {
  rawName: string;
  occurrenceCount: number;
  providers: string[];
  sampleReportId: number;
  sampleReportDate: string | null;
  sampleValue: string;
  sampleUnits: string | null;
}

export interface UnmappedSummary {
  totalUnmappedMetrics: number;
  distinctRawNames: number;
  rows: UnmappedMetricRow[];
}

// Distinct raw metric names without a canonical mapping, ordered by
// occurrence count desc. Used by /mappings and the dashboard banner.
export function getUnmappedSummary(): UnmappedSummary {
  const rows = db
    .select({
      metricId: metricsTable.id,
      name: metricsTable.name,
      valueNumeric: metricsTable.valueNumeric,
      valueText: metricsTable.valueText,
      units: metricsTable.units,
      reportId: metricsTable.reportId,
      reportDate: reports.reportDate,
      uploadedAt: reports.uploadedAt,
      provider: reports.provider,
    })
    .from(metricsTable)
    .innerJoin(reports, eq(metricsTable.reportId, reports.id))
    .where(isNull(metricsTable.canonicalMetricId))
    .orderBy(desc(reports.reportDate), desc(reports.uploadedAt))
    .all();

  type Acc = {
    rawName: string;
    count: number;
    providers: Set<string>;
    sample: {
      reportId: number;
      reportDate: string | null;
      value: string;
      units: string | null;
    };
  };
  const byLower = new Map<string, Acc>();
  for (const r of rows) {
    const key = r.name.trim().toLowerCase();
    if (!key) continue;
    const existing = byLower.get(key);
    const value =
      r.valueNumeric != null
        ? `${r.valueNumeric}`
        : (r.valueText ?? "—");
    if (!existing) {
      byLower.set(key, {
        rawName: r.name.trim(),
        count: 1,
        providers: new Set([r.provider]),
        sample: {
          reportId: r.reportId,
          reportDate: r.reportDate,
          value,
          units: r.units,
        },
      });
    } else {
      existing.count += 1;
      existing.providers.add(r.provider);
    }
  }

  const rowsOut: UnmappedMetricRow[] = [];
  for (const acc of byLower.values()) {
    rowsOut.push({
      rawName: acc.rawName,
      occurrenceCount: acc.count,
      providers: [...acc.providers].sort(),
      sampleReportId: acc.sample.reportId,
      sampleReportDate: acc.sample.reportDate,
      sampleValue: acc.sample.value,
      sampleUnits: acc.sample.units,
    });
  }
  rowsOut.sort(
    (a, b) =>
      b.occurrenceCount - a.occurrenceCount ||
      a.rawName.localeCompare(b.rawName),
  );

  return {
    totalUnmappedMetrics: rows.length,
    distinctRawNames: byLower.size,
    rows: rowsOut,
  };
}

export interface CanonicalOption {
  id: number;
  canonicalName: string;
  category: string;
}

// Canonical metrics ordered by name — feeds the dropdown in /mappings.
export function getCanonicalOptions(): CanonicalOption[] {
  return db
    .select({
      id: canonicalMetricsTable.id,
      canonicalName: canonicalMetricsTable.canonicalName,
      category: canonicalMetricsTable.category,
    })
    .from(canonicalMetricsTable)
    .orderBy(asc(canonicalMetricsTable.canonicalName))
    .all();
}

