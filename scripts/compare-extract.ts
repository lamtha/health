// Run both extractors on the same PDF and diff the metric sets.
// Dev tool for verifying deterministic parser quality against Claude's
// output — no DB writes, just reads + prints.
//
// Usage:
//   pnpm compare-extract <pdf-path>
//   pnpm compare-extract <report-id>          # looks up file_path in DB
//   pnpm compare-extract <pdf-path> --json    # machine-readable diff

import fs from "node:fs";
import { eq } from "drizzle-orm";

import { db } from "../lib/db";
import { reports } from "../db/schema";
import { extractReportFromPdf, type ExtractedMetric } from "../lib/extract";
import { tryDeterministicExtract } from "../lib/parsers";

interface ExtractorRun {
  label: string;
  kind: string;
  version: number | null;
  elapsedMs: number;
  metrics: ExtractedMetric[];
}

interface MatchedRow {
  key: string;
  det: ExtractedMetric;
  cld: ExtractedMetric;
}

interface DiffReport {
  determinisitc: ExtractorRun;
  claude: ExtractorRun;
  matched: MatchedRow[];
  valueMismatches: MatchedRow[];
  unitsMismatches: MatchedRow[];
  onlyDeterministic: ExtractedMetric[];
  onlyClaude: ExtractedMetric[];
}

const VALUE_TOLERANCE = 0.05;

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+spp\.?\s*$/i, " spp")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function metricKey(m: ExtractedMetric, panel: boolean): string {
  const name = normalizeName(m.name);
  return panel && m.panel ? `${normalizeName(m.panel)}::${name}` : name;
}

function indexBy(
  metrics: ExtractedMetric[],
  panelScoped: boolean,
): Map<string, ExtractedMetric> {
  const out = new Map<string, ExtractedMetric>();
  for (const m of metrics) {
    const k = metricKey(m, panelScoped);
    if (!out.has(k)) out.set(k, m);
  }
  return out;
}

function valuesEquivalent(a: ExtractedMetric, b: ExtractedMetric): boolean {
  if (a.valueText && b.valueText) {
    return a.valueText.toLowerCase() === b.valueText.toLowerCase();
  }
  if (a.valueText || b.valueText) return false;
  if (a.valueNumeric == null && b.valueNumeric == null) return true;
  if (a.valueNumeric == null || b.valueNumeric == null) return false;
  if (a.valueNumeric === 0 && b.valueNumeric === 0) return true;
  const denom = Math.max(Math.abs(a.valueNumeric), Math.abs(b.valueNumeric));
  if (denom === 0) return true;
  const delta = Math.abs(a.valueNumeric - b.valueNumeric) / denom;
  return delta <= VALUE_TOLERANCE;
}

function unitsEquivalent(a: ExtractedMetric, b: ExtractedMetric): boolean {
  const ua = (a.units ?? "").toLowerCase().replace(/\s+/g, "");
  const ub = (b.units ?? "").toLowerCase().replace(/\s+/g, "");
  return ua === ub;
}

async function runDeterministic(pdfPath: string): Promise<ExtractorRun | null> {
  const result = await tryDeterministicExtract(pdfPath);
  if (!result) return null;
  return {
    label: result.model,
    kind: result.kind,
    version: result.version,
    elapsedMs: result.elapsedMs,
    metrics: result.report.metrics,
  };
}

async function runClaude(pdfPath: string): Promise<ExtractorRun> {
  const result = await extractReportFromPdf(pdfPath);
  return {
    label: result.model,
    kind: result.kind,
    version: result.version,
    elapsedMs: result.elapsedMs,
    metrics: result.report.metrics,
  };
}

function diff(det: ExtractorRun, cld: ExtractorRun): DiffReport {
  const detIdx = indexBy(det.metrics, true);
  const cldIdx = indexBy(cld.metrics, true);

  const matched: MatchedRow[] = [];
  const valueMismatches: MatchedRow[] = [];
  const unitsMismatches: MatchedRow[] = [];
  const onlyDeterministic: ExtractedMetric[] = [];
  const onlyClaude: ExtractedMetric[] = [];

  // Try panel-scoped match first; fall back to name-only for misses.
  const detLeftover = new Map(detIdx);
  const cldLeftover = new Map(cldIdx);

  for (const [k, d] of detIdx) {
    const c = cldIdx.get(k);
    if (!c) continue;
    detLeftover.delete(k);
    cldLeftover.delete(k);
    const row = { key: k, det: d, cld: c };
    if (!unitsEquivalent(d, c)) unitsMismatches.push(row);
    else if (!valuesEquivalent(d, c)) valueMismatches.push(row);
    else matched.push(row);
  }

  // Second pass: name-only match for the leftovers.
  const detByName = new Map<string, [string, ExtractedMetric]>();
  for (const [k, m] of detLeftover) {
    detByName.set(normalizeName(m.name), [k, m]);
  }
  for (const [k, c] of cldLeftover) {
    const name = normalizeName(c.name);
    const hit = detByName.get(name);
    if (!hit) {
      onlyClaude.push(c);
      continue;
    }
    const [dk, d] = hit;
    detByName.delete(name);
    detLeftover.delete(dk);
    cldLeftover.delete(k);
    const row = { key: `~${name}`, det: d, cld: c };
    if (!unitsEquivalent(d, c)) unitsMismatches.push(row);
    else if (!valuesEquivalent(d, c)) valueMismatches.push(row);
    else matched.push(row);
  }
  for (const [, m] of detLeftover) onlyDeterministic.push(m);

  return {
    determinisitc: det,
    claude: cld,
    matched,
    valueMismatches,
    unitsMismatches,
    onlyDeterministic,
    onlyClaude,
  };
}

function fmtValue(m: ExtractedMetric): string {
  if (m.valueNumeric != null) return m.valueNumeric.toExponential(3);
  if (m.valueText) return m.valueText;
  return "—";
}

function pctDelta(a: number | null | undefined, b: number | null | undefined): string {
  if (a == null || b == null || a === 0) return "—";
  const d = ((b - a) / a) * 100;
  const sign = d >= 0 ? "+" : "";
  return `${sign}${d.toFixed(1)}%`;
}

function printReport(d: DiffReport): void {
  const det = d.determinisitc;
  const cld = d.claude;
  console.log(
    `${det.label}${det.version != null ? ` v${det.version}` : ""} (${det.kind})  →  ${det.metrics.length} metrics, ${(det.elapsedMs / 1000).toFixed(1)}s`,
  );
  console.log(
    `${cld.label} (${cld.kind})  →  ${cld.metrics.length} metrics, ${(cld.elapsedMs / 1000).toFixed(1)}s`,
  );
  console.log("");
  console.log(`MATCHED   ${d.matched.length.toString().padStart(4)}  same value, same units`);
  console.log(`VALUE     ${d.valueMismatches.length.toString().padStart(4)}  value mismatch (>${(VALUE_TOLERANCE * 100).toFixed(0)}% delta)`);
  console.log(`UNITS     ${d.unitsMismatches.length.toString().padStart(4)}  units differ`);
  console.log(`ONLY-DET  ${d.onlyDeterministic.length.toString().padStart(4)}  only in deterministic`);
  console.log(`ONLY-CLD  ${d.onlyClaude.length.toString().padStart(4)}  only in claude`);
  console.log("");

  if (d.valueMismatches.length > 0) {
    console.log("# value mismatches");
    for (const r of d.valueMismatches) {
      console.log(
        `  ${r.det.name.padEnd(40)}  det=${fmtValue(r.det).padEnd(12)}  cld=${fmtValue(r.cld).padEnd(12)}  ${pctDelta(r.det.valueNumeric, r.cld.valueNumeric)}`,
      );
    }
    console.log("");
  }
  if (d.unitsMismatches.length > 0) {
    console.log("# units differ");
    for (const r of d.unitsMismatches) {
      console.log(
        `  ${r.det.name.padEnd(40)}  det=${(r.det.units ?? "—").padEnd(12)}  cld=${(r.cld.units ?? "—").padEnd(12)}`,
      );
    }
    console.log("");
  }
  if (d.onlyDeterministic.length > 0) {
    console.log("# only in deterministic");
    for (const m of d.onlyDeterministic) {
      console.log(`  [${m.panel ?? "—"}] ${m.name}  =  ${fmtValue(m)} ${m.units ?? ""}`.trim());
    }
    console.log("");
  }
  if (d.onlyClaude.length > 0) {
    console.log("# only in claude");
    for (const m of d.onlyClaude) {
      console.log(`  [${m.panel ?? "—"}] ${m.name}  =  ${fmtValue(m)} ${m.units ?? ""}`.trim());
    }
    console.log("");
  }
}

function resolvePdfPath(arg: string): string {
  if (/^\d+$/.test(arg)) {
    const id = Number(arg);
    const r = db.select().from(reports).where(eq(reports.id, id)).get();
    if (!r) throw new Error(`report ${id} not found`);
    if (!fs.existsSync(r.filePath)) {
      throw new Error(
        `report ${id}: source PDF missing at ${r.filePath}`,
      );
    }
    return r.filePath;
  }
  if (!fs.existsSync(arg)) throw new Error(`PDF not found: ${arg}`);
  return arg;
}

async function main() {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith("--"));
  const asJson = args.includes("--json");

  if (!target) {
    console.error("usage: pnpm compare-extract <pdf-path-or-report-id> [--json]");
    process.exit(1);
  }

  const pdfPath = resolvePdfPath(target);
  console.error(`comparing extractors on: ${pdfPath}`);

  const [det, cld] = await Promise.all([
    runDeterministic(pdfPath),
    runClaude(pdfPath),
  ]);

  if (!det) {
    console.error(
      "no deterministic parser matched this PDF — nothing to compare",
    );
    process.exit(2);
  }

  const report = diff(det, cld);

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
