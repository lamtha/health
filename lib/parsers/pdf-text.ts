import "server-only";

import fs from "node:fs/promises";

export interface ExtractedPdfText {
  pages: string[];
  text: string;
}

interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  hasEOL?: boolean;
}

// Extract text from a PDF using pdfjs-dist's legacy build (no Web Worker).
// Items are grouped by y-coordinate to reconstruct rows; large x-gaps within
// a row are widened to a tab so downstream regex can split columns reliably.
export async function extractPdfText(pdfPath: string): Promise<ExtractedPdfText> {
  const data = await fs.readFile(pdfPath);

  // Dynamic import dodges Next.js bundling for the (Node-only) legacy build.
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as {
    getDocument: (args: unknown) => { promise: Promise<PdfDocument> };
  };

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(data),
    useSystemFonts: true,
    verbosity: 0,
    isEvalSupported: false,
  }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(itemsToText(content.items as PdfTextItem[]));
    page.cleanup?.();
  }
  await doc.cleanup?.();
  await doc.destroy?.();

  return { pages, text: pages.join("\n\n") };
}

interface PdfDocument {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
  cleanup?: () => Promise<void>;
  destroy?: () => Promise<void>;
}

interface PdfPage {
  getTextContent: () => Promise<{ items: unknown[] }>;
  cleanup?: () => void;
}

const Y_TOLERANCE = 4;
const COLUMN_GAP_PX = 8;

function itemsToText(items: PdfTextItem[]): string {
  // Position-keyed dedupe: GI-MAP renders bold rows by drawing the same text
  // twice at nearly-identical positions. Round to integer pixels so the second
  // pass collapses into the first.
  const seen = new Set<string>();
  const dedup: PdfTextItem[] = [];
  for (const it of items) {
    if (typeof it.str !== "string" || !it.transform) continue;
    const s = it.str;
    if (s.length === 0) continue;
    const key = `${Math.round(it.transform[4])},${Math.round(it.transform[5])},${s}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(it);
  }

  const rows = new Map<number, PdfTextItem[]>();
  for (const it of dedup) {
    const yKey = Math.round(it.transform[5] / Y_TOLERANCE) * Y_TOLERANCE;
    const arr = rows.get(yKey) ?? [];
    arr.push(it);
    rows.set(yKey, arr);
  }

  const ys = [...rows.keys()].sort((a, b) => b - a);
  const lines: string[] = [];
  for (const y of ys) {
    const row = rows.get(y)!;
    row.sort((a, b) => a.transform[4] - b.transform[4]);
    let line = "";
    let prevEnd: number | null = null;
    let prevStr = "";
    for (const it of row) {
      const x = it.transform[4];
      const end = x + (it.width ?? 0);
      // Drop adjacent duplicate strings (handles the doubled-render case where
      // two items at slightly different x-pixels produce the same glyph run).
      if (it.str.trim() && it.str === prevStr && prevEnd !== null && x - prevEnd < 4) {
        continue;
      }
      if (prevEnd !== null && x - prevEnd > COLUMN_GAP_PX) {
        line += "\t";
      } else if (line.length > 0 && !line.endsWith(" ") && !line.endsWith("\t")) {
        line += " ";
      }
      line += it.str;
      prevEnd = end;
      prevStr = it.str;
    }
    const trimmed = line.replace(/[ \t]+$/g, "").replace(/^\s+/, "");
    if (trimmed) lines.push(trimmed);
  }
  return lines.join("\n");
}
