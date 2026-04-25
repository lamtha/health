import "server-only";

import fs from "node:fs";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { resolveCanonicalId } from "@/lib/canonical";
import {
  extractions,
  metrics as metricsTable,
  panels as panelsTable,
  reports,
} from "@/db/schema";
import {
  ExtractedReport,
  extractReportFromPdf,
  parseExtractionFromRaw,
  type ExtractedReport as ExtractedReportT,
} from "@/lib/extract";
import { tryDeterministicExtract } from "@/lib/parsers";

export interface ReExtractResult {
  reportId: number;
  extractionId: number;
  panelCount: number;
  metricCount: number;
  model: string;
  elapsedMs: number;
  mode: "live" | "replay";
}

function replacePanelsAndMetrics(
  reportId: number,
  extraction: ExtractedReportT,
): { panelCount: number; metricCount: number; extractionTouched: false };
function replacePanelsAndMetrics(
  reportId: number,
  extraction: ExtractedReportT,
  appendExtraction: { model: string; rawJson: unknown },
): { panelCount: number; metricCount: number; extractionId: number };
function replacePanelsAndMetrics(
  reportId: number,
  extraction: ExtractedReportT,
  appendExtraction?: { model: string; rawJson: unknown },
): {
  panelCount: number;
  metricCount: number;
  extractionId?: number;
  extractionTouched?: false;
} {
  return db.transaction((tx) => {
    tx.update(reports)
      .set({
        provider: extraction.provider,
        category: extraction.category,
        reportDate: extraction.reportDate ?? null,
      })
      .where(eq(reports.id, reportId))
      .run();

    tx.delete(metricsTable).where(eq(metricsTable.reportId, reportId)).run();
    tx.delete(panelsTable).where(eq(panelsTable.reportId, reportId)).run();

    const panelNames = new Set<string>();
    for (const m of extraction.metrics) {
      if (m.panel) panelNames.add(m.panel);
    }
    const panelIdByName = new Map<string, number>();
    for (const name of panelNames) {
      const [row] = tx
        .insert(panelsTable)
        .values({ reportId, name })
        .returning()
        .all();
      panelIdByName.set(name, row.id);
    }

    let metricCount = 0;
    for (const m of extraction.metrics) {
      tx.insert(metricsTable)
        .values({
          reportId,
          panelId: m.panel ? panelIdByName.get(m.panel) ?? null : null,
          canonicalMetricId: resolveCanonicalId(m.name, extraction.provider),
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

    if (appendExtraction) {
      const [row] = tx
        .insert(extractions)
        .values({
          reportId,
          model: appendExtraction.model,
          rawJson: appendExtraction.rawJson,
        })
        .returning()
        .all();
      return {
        panelCount: panelIdByName.size,
        metricCount,
        extractionId: row.id,
      };
    }
    return {
      panelCount: panelIdByName.size,
      metricCount,
      extractionTouched: false,
    };
  });
}

export interface ReExtractOptions {
  // "auto" (default): try deterministic, fall through to Claude on miss.
  //   Same behavior as the upload pipeline (lib/batch-runner.ts).
  // "offline": deterministic only — throw if no parser matches. Used by
  //   the modal's Offline option, where the value prop is privacy: the
  //   PDF must not leave the machine, so a silent Claude fallback is wrong.
  // "claude": always Claude, regardless of available parsers.
  parser?: "auto" | "offline" | "claude";
}

export async function reExtractReport(
  reportId: number,
  opts: ReExtractOptions = {},
): Promise<ReExtractResult> {
  const mode = opts.parser ?? "auto";
  const report = db
    .select()
    .from(reports)
    .where(eq(reports.id, reportId))
    .get();
  if (!report) throw new Error(`report ${reportId} not found`);
  if (!fs.existsSync(report.filePath)) {
    throw new Error(
      `source PDF missing at ${report.filePath}; cannot re-extract`,
    );
  }

  let result;
  if (mode === "claude") {
    result = await extractReportFromPdf(report.filePath);
  } else {
    const deterministic = await tryDeterministicExtract(report.filePath);
    if (deterministic) {
      result = deterministic;
    } else if (mode === "offline") {
      throw new Error(
        "No deterministic parser matched this PDF. Pick the Claude API option to send it to Anthropic.",
      );
    } else {
      result = await extractReportFromPdf(report.filePath);
    }
  }
  const parsed = ExtractedReport.parse(result.report);

  const persisted = replacePanelsAndMetrics(reportId, parsed, {
    model: result.model,
    rawJson: result.raw,
  });

  return {
    reportId,
    extractionId: persisted.extractionId,
    panelCount: persisted.panelCount,
    metricCount: persisted.metricCount,
    model: result.model,
    elapsedMs: result.elapsedMs,
    mode: "live",
  };
}

export function replayReportFromLatestExtraction(
  reportId: number,
): ReExtractResult {
  const report = db
    .select()
    .from(reports)
    .where(eq(reports.id, reportId))
    .get();
  if (!report) throw new Error(`report ${reportId} not found`);

  const latest = db
    .select()
    .from(extractions)
    .where(eq(extractions.reportId, reportId))
    .all()
    .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))[0];
  if (!latest) {
    throw new Error(`no extraction rows found for report ${reportId}`);
  }

  const raw = latest.rawJson as { report?: unknown } | unknown;
  const reportPayload =
    raw && typeof raw === "object" && raw !== null && "report" in raw
      ? (raw as { report: unknown }).report
      : raw;

  const parsed = parseExtractionFromRaw(reportPayload);

  const started = Date.now();
  const persisted = replacePanelsAndMetrics(reportId, parsed);
  return {
    reportId,
    extractionId: latest.id,
    panelCount: persisted.panelCount,
    metricCount: persisted.metricCount,
    model: latest.model,
    elapsedMs: Date.now() - started,
    mode: "replay",
  };
}
