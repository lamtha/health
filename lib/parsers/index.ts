import "server-only";

import type { ExtractedReport, ExtractionResult } from "@/lib/extract";
import { extractPdfText } from "./pdf-text";
import * as gimap from "./gimap";

export interface DeterministicParser {
  name: string;
  detect: (text: string) => boolean;
  parseText: (text: string) => ExtractedReport;
}

const PARSERS: DeterministicParser[] = [gimap];

// Try each registered parser against the extracted text. First match wins.
// On parse-throw, log + return null so the caller falls back to Claude.
// On detection miss across all parsers, return null.
export async function tryDeterministicExtract(
  pdfPath: string,
): Promise<ExtractionResult | null> {
  const started = Date.now();

  let pdfText;
  try {
    pdfText = await extractPdfText(pdfPath);
  } catch (err) {
    console.warn(`[parsers] PDF text extraction failed for ${pdfPath}:`, err);
    return null;
  }

  for (const parser of PARSERS) {
    if (!parser.detect(pdfText.text)) continue;
    try {
      const report = parser.parseText(pdfText.text);
      return {
        report,
        raw: { kind: "deterministic", parser: parser.name, version: 1, report },
        model: `deterministic-${parser.name}`,
        elapsedMs: Date.now() - started,
      };
    } catch (err) {
      console.warn(
        `[parsers] ${parser.name} matched but threw — falling back:`,
        (err as Error).message,
      );
      return null;
    }
  }

  return null;
}
