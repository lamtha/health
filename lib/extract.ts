import "server-only";

import fs from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

export const ExtractedMetric = z.object({
  name: z.string().min(1),
  panel: z.string().optional().nullable(),
  valueNumeric: z.number().nullable().optional(),
  valueText: z.string().nullable().optional(),
  units: z.string().nullable().optional(),
  refLow: z.number().nullable().optional(),
  refHigh: z.number().nullable().optional(),
  refText: z.string().nullable().optional(),
  flag: z.enum(["high", "low", "ok"]).nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
});
export type ExtractedMetric = z.infer<typeof ExtractedMetric>;

export const ExtractedReport = z.object({
  provider: z.string().min(1),
  category: z.enum(["blood", "gi", "imaging", "aging", "clinical", "wearable", "other"]),
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  metrics: z.array(ExtractedMetric),
});
export type ExtractedReport = z.infer<typeof ExtractedReport>;

export interface ExtractionResult {
  report: ExtractedReport;
  raw: unknown;
  // Engine identifier — claude model id ("claude-sonnet-4-6") or
  // deterministic parser name ("gimap").
  model: string;
  // Distinguishes the cloud Anthropic API path from a local parser.
  kind: "claude" | "deterministic";
  // Deterministic parser version. Null for claude (model id is enough).
  version: number | null;
  elapsedMs: number;
}

const DEFAULT_MODEL = process.env.ANTHROPIC_EXTRACTION_MODEL ?? "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 32_000;
// 1M context window beta for Sonnet 4.x — lets long GI panels fit without truncating input.
const BETA_HEADERS = ["context-1m-2025-08-07"] as const;

const SYSTEM_PROMPT = `You are a medical lab report extractor. The PDF is a lab, imaging, or clinical report from a single provider. Supported provider types include blood/serum labs (Quest, LabCorp, Lifeforce, Function Health, Genova) and GI / microbiome labs (GI-MAP by Diagnostic Solutions, GI-360 by Doctor's Data, Gut Zoomer by Vibrant America, Viome Gut Intelligence, Meridian Valley MARCoNS, Mosaic Organic Acids / OAT, Great Plains, etc.).

Return a single JSON object with this exact shape (no prose, no markdown fences):

{
  "provider": string,                 // normalized lower-kebab. Preferred values: "quest", "labcorp", "lifeforce", "function-health", "genova", "vibrant-america", "meridian-valley", "gi-map", "gi-360", "gut-zoomer", "viome", "mosaic", "great-plains". For an unknown lab, invent a concise lower-kebab slug.
  "category": "blood" | "gi" | "imaging" | "aging" | "clinical" | "wearable" | "other",
  "reportDate": "YYYY-MM-DD" | null,  // specimen/collection date preferred; else report/issued date
  "metrics": [
    {
      "name": string,                 // raw marker name exactly as printed (e.g. "Akkermansia muciniphila", "Calprotectin", "WBC")
      "panel": string | null,         // section header on the report (e.g. "CBC", "CMP", "Lipid Panel", "Commensal Bacteria", "Intestinal Health Markers", "SCFAs", "Parasites")
      "valueNumeric": number | null,  // numeric value; null for qualitative or below-detection results
      "valueText": string | null,     // non-numeric result verbatim: "Positive", "Not Detected", "<dl", "Average Activity", etc.
      "units": string | null,         // e.g. "mg/dL", "%", "CFU/g", "copies/g", "ng/g", "cells/mL"
      "refLow": number | null,        // numeric lower bound of reference range
      "refHigh": number | null,       // numeric upper bound
      "refText": string | null,       // verbatim range string: "<1.0", "Not detected", "Normal <2.0E3"
      "flag": "high" | "low" | "ok" | null,
      "confidence": number            // 0..1, your confidence in this row
    }
  ]
}

General rules:
- Extract every numeric or discrete marker you can see. Do not invent rows.
- Preserve the raw metric name exactly as it appears, including case and spelling.
- Scientific notation ("1.25E4", "2.3 x 10^5") → numeric value (12500, 230000). Also copy the printed form into refText if it appears in the range.
- Percentages ("12.4%") → valueNumeric: 12.4, units: "%".
- When a reference range is printed, always set refText verbatim, and populate refLow/refHigh numerically whenever the range is bounded numerically.
- flag: if the row is explicitly marked H / L / Abnormal / High / Low, map to "high" / "low". If it is explicitly marked in range / normal / within reference, use "ok". Otherwise null.

GI / microbiome notes:
- Below detection limit ("< dl", "<DL", "below detection", "Not detected") → valueNumeric: null, valueText: the verbatim text, units preserved. Do NOT substitute zero.
- Qualitative results ("Detected", "Not Detected", "Positive", "Negative", "Present") → valueText: the label, valueNumeric: null.
- Ordinal / categorical results (Viome "Low Activity" / "Average" / "High Activity") → valueText: the label; if a numeric sub-score is printed alongside, put it in valueNumeric.
- Organism abundance printed as a percentage → valueNumeric: the number, units: "%". Do not collapse species into their genus; keep each taxon as its own row.
- qPCR readings ("CFU/g", "copies/g", "cells/g") → valueNumeric numeric, units as printed.
- Short-chain fatty acids, bile acids, calprotectin, zonulin, secretory IgA, beta-glucuronidase, pancreatic elastase — treat like blood markers: numeric value + units + range.
- Use panel names from the section headers actually printed on the report; do not invent them.

confidence reflects OCR / structural certainty, not clinical interpretation.

Respond with raw JSON only.`;

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1].trim() : trimmed;
}

// Attempt to recover a usable JSON object when the response was cut off
// mid-metric inside the "metrics" array. Walks the text tracking string
// and brace state, finds the last complete object inside the metrics
// array, and closes the array + outer object there. Returns null if the
// shape doesn't match that pattern (e.g. truncation happened before the
// array opened, or the JSON is malformed for a different reason).
function salvageTruncatedJson(text: string): { parsed: unknown; droppedTailChars: number } | null {
  const metricsKey = text.indexOf('"metrics"');
  if (metricsKey < 0) return null;
  const arrStart = text.indexOf("[", metricsKey);
  if (arrStart < 0) return null;

  let inString = false;
  let escape = false;
  let depth = 0;
  let lastCompleteObjectEnd = -1;

  for (let i = arrStart + 1; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) lastCompleteObjectEnd = i;
    } else if (ch === "]" && depth === 0) {
      // Array already closed cleanly — nothing to salvage here.
      return null;
    }
  }

  if (lastCompleteObjectEnd < 0) return null;

  const truncated = text.slice(0, lastCompleteObjectEnd + 1) + "]}";
  try {
    const parsed = JSON.parse(truncated);
    return { parsed, droppedTailChars: text.length - (lastCompleteObjectEnd + 1) };
  } catch {
    return null;
  }
}

export function parseExtractionFromRaw(raw: unknown): ExtractedReport {
  return ExtractedReport.parse(raw);
}

export async function extractReportFromPdf(pdfPath: string): Promise<ExtractionResult> {
  const client = new Anthropic();
  const pdfBytes = await fs.readFile(pdfPath);
  const pdfBase64 = pdfBytes.toString("base64");

  const started = Date.now();
  // Streaming is required once max_tokens crosses the SDK's 10-minute
  // non-streaming guard; finalMessage() gives us the assembled Message
  // with the same shape as messages.create().
  const stream = client.beta.messages.stream({
    model: DEFAULT_MODEL,
    max_tokens: DEFAULT_MAX_TOKENS,
    betas: [...BETA_HEADERS],
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: pdfBase64,
            },
          },
          {
            type: "text",
            text: "Extract this report. Respond with the JSON object only.",
          },
        ],
      },
    ],
  });
  const message = await stream.finalMessage();
  const elapsedMs = Date.now() - started;

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text content");
  }

  const cleaned = stripJsonFences(textBlock.text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    const salvage = salvageTruncatedJson(cleaned);
    if (!salvage) {
      throw new Error(
        `Failed to parse Claude JSON: ${(err as Error).message}\n---\n${textBlock.text.slice(0, 2000)}`,
      );
    }
    console.warn(
      `[extract] salvaged truncated JSON — dropped ${salvage.droppedTailChars} trailing chars`,
    );
    parsed = salvage.parsed;
  }

  const report = ExtractedReport.parse(parsed);

  return {
    report,
    raw: parsed,
    model: DEFAULT_MODEL,
    kind: "claude",
    version: null,
    elapsedMs,
  };
}
