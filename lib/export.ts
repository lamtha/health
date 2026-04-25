import "server-only";

import { and, eq, gte, inArray, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  canonicalMetrics as canonicalMetricsTable,
  interventions,
  metrics as metricsTable,
  reports,
} from "@/db/schema";
import { canonicalUnit } from "@/lib/units";
import { coerceTags } from "@/lib/queries";
import { CATEGORY_LABELS } from "@/db/seeds/taxonomy";

export interface ExportObservation {
  date: string;
  provider: string;
  rawName: string;
  value: number | null;
  valueText: string | null;
  units: string | null;
  refLow: number | null;
  refHigh: number | null;
  flag: string | null;
}

export interface ExportSeries {
  canonicalMetricId: number;
  canonicalName: string;
  category: string;
  categoryLabel: string;
  units: string | null; // dominant unit across kept observations
  refLow: number | null;
  refHigh: number | null;
  observations: ExportObservation[];
}

export interface ExportIntervention {
  id: number;
  name: string;
  kind: string;
  dose: string | null;
  startedOn: string;
  stoppedOn: string | null;
  activeDuringWindow: boolean;
}

export interface ExportDataset {
  fromDate: string;
  toDate: string;
  generatedAt: string;
  series: ExportSeries[];
  interventions: ExportIntervention[];
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

// Build the full clinician-ready dataset for a date window + canonical
// metric selection. Consumed by both the PDF renderer and CSV writer.
export function buildExportDataset(input: {
  fromDate: string;
  toDate: string;
  canonicalIds: number[];
}): ExportDataset {
  const { fromDate, toDate, canonicalIds } = input;

  const canonicalRows = db
    .select({
      id: canonicalMetricsTable.id,
      canonicalName: canonicalMetricsTable.canonicalName,
      category: canonicalMetricsTable.category,
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
      name: metricsTable.name,
      valueNumeric: metricsTable.valueNumeric,
      valueText: metricsTable.valueText,
      units: metricsTable.units,
      refLow: metricsTable.refLow,
      refHigh: metricsTable.refHigh,
      flag: metricsTable.flag,
      reportDate: reports.reportDate,
      provider: reports.provider,
    })
    .from(metricsTable)
    .innerJoin(reports, eq(metricsTable.reportId, reports.id))
    .where(
      and(
        inArray(metricsTable.canonicalMetricId, canonicalIds),
        gte(reports.reportDate, fromDate),
        lte(reports.reportDate, toDate),
      ),
    )
    .all();

  const byCanonical = new Map<number, typeof metricRows>();
  for (const r of metricRows) {
    if (r.canonicalMetricId == null) continue;
    let list = byCanonical.get(r.canonicalMetricId);
    if (!list) {
      list = [];
      byCanonical.set(r.canonicalMetricId, list);
    }
    list.push(r);
  }

  const series: ExportSeries[] = [];
  for (const id of canonicalIds) {
    const canonical = canonicalById.get(id);
    if (!canonical) continue;
    const rows = byCanonical.get(id) ?? [];

    // Dominant canonical unit — drop observations whose units disagree
    // so the table + chart are self-consistent.
    const canonicalUnits = rows.map((r) => canonicalUnit(r.units));
    const dominantCanonical = pickDominant(canonicalUnits);
    const kept = rows.filter(
      (r) => canonicalUnit(r.units) === dominantCanonical,
    );

    const unitsDisplay =
      pickDominant(kept.map((r) => r.units)) ?? canonical.preferredUnits;

    const refLow = pickDominant(
      kept.map((r) => r.refLow).filter((v): v is number => v != null),
    );
    const refHigh = pickDominant(
      kept.map((r) => r.refHigh).filter((v): v is number => v != null),
    );

    const observations: ExportObservation[] = kept
      .filter((r) => r.reportDate)
      .map((r) => ({
        date: r.reportDate as string,
        provider: r.provider,
        rawName: r.name,
        value: r.valueNumeric,
        valueText: r.valueText,
        units: r.units,
        refLow: r.refLow,
        refHigh: r.refHigh,
        flag: r.flag,
      }));
    observations.sort((a, b) => a.date.localeCompare(b.date));

    series.push({
      canonicalMetricId: id,
      canonicalName: canonical.canonicalName,
      category: canonical.category,
      categoryLabel:
        CATEGORY_LABELS[canonical.category as keyof typeof CATEGORY_LABELS] ??
        canonical.category,
      units: unitsDisplay,
      refLow,
      refHigh,
      observations,
    });
  }

  const interventionRows = db.select().from(interventions).all();
  const interventionsInWindow: ExportIntervention[] = interventionRows
    .filter((i) => {
      const start = i.startedOn;
      const stop = i.stoppedOn ?? toDate; // still active — overlaps window right-edge
      return start <= toDate && stop >= fromDate;
    })
    .map((i) => ({
      id: i.id,
      name: i.name,
      kind: i.kind,
      dose: i.dose,
      startedOn: i.startedOn,
      stoppedOn: i.stoppedOn,
      activeDuringWindow: true,
    }));

  return {
    fromDate,
    toDate,
    generatedAt: new Date().toISOString(),
    series,
    interventions: interventionsInWindow,
  };
}

// CSV — one row per observation. Simple, clinician-friendly columns.
export function datasetToCsv(ds: ExportDataset): string {
  const header = [
    "canonical_name",
    "category",
    "raw_name",
    "provider",
    "date",
    "value",
    "value_text",
    "units",
    "ref_low",
    "ref_high",
    "flag",
  ];
  const lines: string[] = [header.join(",")];
  for (const s of ds.series) {
    for (const o of s.observations) {
      const row = [
        s.canonicalName,
        s.categoryLabel,
        o.rawName,
        o.provider,
        o.date,
        o.value == null ? "" : String(o.value),
        o.valueText ?? "",
        o.units ?? "",
        o.refLow == null ? "" : String(o.refLow),
        o.refHigh == null ? "" : String(o.refHigh),
        o.flag ?? "",
      ].map(csvCell);
      lines.push(row.join(","));
    }
  }
  // Blank line then interventions
  lines.push("");
  lines.push(["intervention_name", "kind", "dose", "started_on", "stopped_on"].join(","));
  for (const i of ds.interventions) {
    lines.push(
      [i.name, i.kind, i.dose ?? "", i.startedOn, i.stoppedOn ?? ""]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

function csvCell(v: string): string {
  if (/[,"\r\n]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

// List of canonical metrics eligible for export (those with ≥1 metric row
// in the given window). Used by the picker UI.
export interface ExportCandidate {
  id: number;
  canonicalName: string;
  category: string;
  categoryLabel: string;
  tags: string[];
  observationsInWindow: number;
  flaggedInWindow: number;
}

export function getExportCandidates(
  fromDate: string,
  toDate: string,
): ExportCandidate[] {
  const rows = db
    .select({
      id: canonicalMetricsTable.id,
      canonicalName: canonicalMetricsTable.canonicalName,
      category: canonicalMetricsTable.category,
      tags: canonicalMetricsTable.tags,
      metricId: metricsTable.id,
      flag: metricsTable.flag,
    })
    .from(canonicalMetricsTable)
    .innerJoin(
      metricsTable,
      eq(metricsTable.canonicalMetricId, canonicalMetricsTable.id),
    )
    .innerJoin(reports, eq(metricsTable.reportId, reports.id))
    .where(
      and(
        gte(reports.reportDate, fromDate),
        lte(reports.reportDate, toDate),
      ),
    )
    .all();

  const byId = new Map<number, ExportCandidate>();
  for (const r of rows) {
    let cur = byId.get(r.id);
    if (!cur) {
      cur = {
        id: r.id,
        canonicalName: r.canonicalName,
        category: r.category,
        categoryLabel:
          CATEGORY_LABELS[r.category as keyof typeof CATEGORY_LABELS] ?? r.category,
        tags: coerceTags(r.tags),
        observationsInWindow: 0,
        flaggedInWindow: 0,
      };
      byId.set(r.id, cur);
    }
    cur.observationsInWindow += 1;
    if (r.flag === "high" || r.flag === "low") cur.flaggedInWindow += 1;
  }
  return [...byId.values()].sort((a, b) =>
    a.canonicalName.localeCompare(b.canonicalName),
  );
}

export interface ExportCounts {
  categoryCounts: Record<string, number>;
  tagCounts: Record<string, number>;
}

// Chip counts for the /export filter strip. One unit per candidate
// (canonical metric with ≥1 obs in window), matching the dashboard's
// "distinct groups" counting model.
export function computeExportCounts(candidates: ExportCandidate[]): ExportCounts {
  const categoryCounts: Record<string, number> = {};
  const tagCounts: Record<string, number> = {};
  for (const c of candidates) {
    categoryCounts[c.category] = (categoryCounts[c.category] ?? 0) + 1;
    for (const t of c.tags) {
      tagCounts[t] = (tagCounts[t] ?? 0) + 1;
    }
  }
  return { categoryCounts, tagCounts };
}
