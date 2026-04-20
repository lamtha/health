import "server-only";

import fs from "node:fs";
import path from "node:path";
import { asc, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  canonicalMetrics as canonicalMetricsTable,
  extractions,
  metrics as metricsTable,
  panels as panelsTable,
  reports,
} from "@/db/schema";

export interface ReportMetric {
  id: number;
  panelId: number | null;
  name: string;
  canonicalMetricId: number | null;
  canonicalName: string | null;
  valueNumeric: number | null;
  valueText: string | null;
  units: string | null;
  refLow: number | null;
  refHigh: number | null;
  flag: "high" | "low" | "ok" | null;
}

export interface ReportPanel {
  id: number | null;
  name: string;
  metrics: ReportMetric[];
}

export interface ReportExtractionInfo {
  id: number;
  model: string;
  createdAt: string;
  lowConfidenceCount: number;
  rawMetricCount: number;
}

export interface ReportDetail {
  report: {
    id: number;
    filePath: string;
    fileHash: string;
    provider: string;
    category: string;
    reportDate: string | null;
    uploadedAt: string;
    originalFilename: string;
    sizeBytes: number | null;
    pdfExists: boolean;
  };
  panels: ReportPanel[];
  flagged: ReportMetric[];
  latestExtraction: ReportExtractionInfo | null;
  extractionCount: number;
}

function parseFlag(v: string | null): "high" | "low" | "ok" | null {
  return v === "high" || v === "low" || v === "ok" ? v : null;
}

export function getReportDetail(id: number): ReportDetail | null {
  const report = db
    .select()
    .from(reports)
    .where(eq(reports.id, id))
    .get();
  if (!report) return null;

  const panelRows = db
    .select()
    .from(panelsTable)
    .where(eq(panelsTable.reportId, id))
    .orderBy(asc(panelsTable.id))
    .all();

  const metricRows = db
    .select({
      id: metricsTable.id,
      panelId: metricsTable.panelId,
      name: metricsTable.name,
      canonicalMetricId: metricsTable.canonicalMetricId,
      canonicalName: canonicalMetricsTable.canonicalName,
      valueNumeric: metricsTable.valueNumeric,
      valueText: metricsTable.valueText,
      units: metricsTable.units,
      refLow: metricsTable.refLow,
      refHigh: metricsTable.refHigh,
      flag: metricsTable.flag,
    })
    .from(metricsTable)
    .leftJoin(
      canonicalMetricsTable,
      eq(metricsTable.canonicalMetricId, canonicalMetricsTable.id),
    )
    .where(eq(metricsTable.reportId, id))
    .orderBy(asc(metricsTable.id))
    .all();

  const panelById = new Map<number, ReportPanel>();
  for (const p of panelRows) {
    panelById.set(p.id, { id: p.id, name: p.name, metrics: [] });
  }
  const orphan: ReportPanel = { id: null, name: "Other", metrics: [] };
  const mapped: ReportMetric[] = metricRows.map((m) => ({
    id: m.id,
    panelId: m.panelId,
    name: m.name,
    canonicalMetricId: m.canonicalMetricId,
    canonicalName: m.canonicalName,
    valueNumeric: m.valueNumeric,
    valueText: m.valueText,
    units: m.units,
    refLow: m.refLow,
    refHigh: m.refHigh,
    flag: parseFlag(m.flag),
  }));
  for (const m of mapped) {
    if (m.panelId != null && panelById.has(m.panelId)) {
      panelById.get(m.panelId)!.metrics.push(m);
    } else {
      orphan.metrics.push(m);
    }
  }
  const panels = Array.from(panelById.values());
  if (orphan.metrics.length > 0) panels.push(orphan);

  const flagged = mapped.filter(
    (m) => m.flag === "high" || m.flag === "low",
  );

  const extractionRows = db
    .select()
    .from(extractions)
    .where(eq(extractions.reportId, id))
    .orderBy(desc(extractions.createdAt), desc(extractions.id))
    .all();

  let latest: ReportExtractionInfo | null = null;
  if (extractionRows.length > 0) {
    const e = extractionRows[0];
    const raw = e.rawJson as {
      report?: { metrics?: Array<{ confidence?: number | null }> };
      metrics?: Array<{ confidence?: number | null }>;
    } | null;
    const rawMetrics =
      raw && typeof raw === "object"
        ? (raw.report?.metrics ?? raw.metrics ?? [])
        : [];
    const lowConfidenceCount = rawMetrics.filter(
      (m) => typeof m?.confidence === "number" && m.confidence < 0.95,
    ).length;
    latest = {
      id: e.id,
      model: e.model,
      createdAt: e.createdAt,
      lowConfidenceCount,
      rawMetricCount: rawMetrics.length,
    };
  }

  let sizeBytes: number | null = null;
  let pdfExists = false;
  try {
    const st = fs.statSync(report.filePath);
    sizeBytes = st.size;
    pdfExists = true;
  } catch {
    pdfExists = false;
  }

  const originalFilename = path.basename(report.filePath);

  return {
    report: {
      id: report.id,
      filePath: report.filePath,
      fileHash: report.fileHash,
      provider: report.provider,
      category: report.category,
      reportDate: report.reportDate,
      uploadedAt: report.uploadedAt,
      originalFilename,
      sizeBytes,
      pdfExists,
    },
    panels,
    flagged,
    latestExtraction: latest,
    extractionCount: extractionRows.length,
  };
}

export function getLatestExtractionId(reportId: number): number | null {
  const row = db
    .select({ id: extractions.id })
    .from(extractions)
    .where(eq(extractions.reportId, reportId))
    .orderBy(desc(extractions.createdAt), desc(extractions.id))
    .get();
  return row?.id ?? null;
}

export function getExtractionRaw(
  reportId: number,
  extractionId: number,
): unknown | null {
  const row = db
    .select({ rawJson: extractions.rawJson })
    .from(extractions)
    .where(eq(extractions.id, extractionId))
    .get();
  if (!row) return null;
  // Verify it belongs to this report
  const owner = db
    .select({ reportId: extractions.reportId })
    .from(extractions)
    .where(eq(extractions.id, extractionId))
    .get();
  if (!owner || owner.reportId !== reportId) return null;
  return row.rawJson;
}
