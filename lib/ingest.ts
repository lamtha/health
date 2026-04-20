import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { resolveCanonicalId } from "@/lib/canonical";
import type { ExtractedMetric, ExtractedReport } from "@/lib/extract";
import { canonicalUnit } from "@/lib/units";
import {
  extractions,
  metrics as metricsTable,
  panels as panelsTable,
  reports,
} from "@/db/schema";

export interface PersistedReport {
  reportId: number;
  panelCount: number;
  metricCount: number;
  duplicatesDropped: number;
}

// Dedupe metrics within a single report. GI-MAP (and others) sometimes
// print the same measurement in two places — a summary panel and a
// detailed table — which Claude faithfully extracts twice. Collapse by
// (name, canonical unit, numeric value, text value). Keep the first
// occurrence; fill in any null refLow/refHigh/flag from dropped rows so
// the kept row carries whichever version had richer range info.
function dedupeWithinReport(rows: ExtractedMetric[]): {
  unique: ExtractedMetric[];
  droppedCount: number;
  refDisagreements: number;
} {
  const byKey = new Map<string, ExtractedMetric>();
  const order: string[] = [];
  let droppedCount = 0;
  let refDisagreements = 0;

  for (const m of rows) {
    const key = [
      m.name.trim().toLowerCase(),
      canonicalUnit(m.units) ?? "",
      m.valueNumeric ?? "\u0000",
      (m.valueText ?? "").trim().toLowerCase(),
    ].join("\u0001");

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...m });
      order.push(key);
      continue;
    }
    droppedCount += 1;

    if (existing.refLow == null && m.refLow != null) {
      existing.refLow = m.refLow;
    } else if (
      existing.refLow != null &&
      m.refLow != null &&
      existing.refLow !== m.refLow
    ) {
      refDisagreements += 1;
    }

    if (existing.refHigh == null && m.refHigh != null) {
      existing.refHigh = m.refHigh;
    } else if (
      existing.refHigh != null &&
      m.refHigh != null &&
      existing.refHigh !== m.refHigh
    ) {
      refDisagreements += 1;
    }

    if (!existing.flag && m.flag) existing.flag = m.flag;
  }

  return {
    unique: order.map((k) => byKey.get(k)!),
    droppedCount,
    refDisagreements,
  };
}

export function insertExtractedReport(params: {
  filePath: string;
  fileHash: string;
  extraction: ExtractedReport;
  rawJson: unknown;
  model: string;
}): PersistedReport {
  return db.transaction((tx) => {
    const [report] = tx
      .insert(reports)
      .values({
        filePath: params.filePath,
        fileHash: params.fileHash,
        provider: params.extraction.provider,
        category: params.extraction.category,
        reportDate: params.extraction.reportDate ?? null,
      })
      .returning()
      .all();

    tx.insert(extractions)
      .values({
        reportId: report.id,
        model: params.model,
        rawJson: params.rawJson,
      })
      .run();

    const { unique, droppedCount, refDisagreements } = dedupeWithinReport(
      params.extraction.metrics,
    );
    if (droppedCount > 0) {
      console.warn(
        `[ingest] report ${report.id} (${params.filePath}): dropped ${droppedCount} within-report duplicate metric row(s)${
          refDisagreements > 0
            ? ` — ${refDisagreements} had disagreeing ref ranges`
            : ""
        }`,
      );
    }

    const panelNames = new Set<string>();
    for (const m of unique) {
      if (m.panel) panelNames.add(m.panel);
    }
    const panelIdByName = new Map<string, number>();
    for (const name of panelNames) {
      const [row] = tx
        .insert(panelsTable)
        .values({ reportId: report.id, name })
        .returning()
        .all();
      panelIdByName.set(name, row.id);
    }

    let metricCount = 0;
    for (const m of unique) {
      tx.insert(metricsTable)
        .values({
          reportId: report.id,
          panelId: m.panel ? panelIdByName.get(m.panel) ?? null : null,
          canonicalMetricId: resolveCanonicalId(m.name, params.extraction.provider),
          name: m.name,
          valueNumeric: m.valueNumeric ?? null,
          valueText: m.valueText ?? null,
          units: m.units ?? null,
          refLow: m.refLow ?? null,
          refHigh: m.refHigh ?? null,
          flag: m.flag ?? null,
        })
        .run();
      metricCount += 1;
    }

    return {
      reportId: report.id,
      panelCount: panelIdByName.size,
      metricCount,
      duplicatesDropped: droppedCount,
    };
  });
}

export function findReportByHash(fileHash: string) {
  return db
    .select()
    .from(reports)
    .where(eq(reports.fileHash, fileHash))
    .get();
}
