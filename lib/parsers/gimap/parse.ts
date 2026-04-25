import {
  ExtractedReport,
  type ExtractedMetric,
  type ExtractedReport as ExtractedReportType,
} from "@/lib/extract";
import { extractPdfText } from "../pdf-text";
import {
  findSection,
  isNoiseLine,
  isUmbrellaBanner,
} from "./sections";
import {
  classifyValue,
  isAnalyteOnlyRow,
  isValueOnlyRow,
  leadsWithValue,
  parseRange,
  tokenize,
} from "./rows";

const PROVIDER = "gi-map";
const CATEGORY = "gi" as const;
const MIN_METRICS = 30;

export async function parsePdf(pdfPath: string): Promise<ExtractedReportType> {
  const { text } = await extractPdfText(pdfPath);
  return parseText(text);
}

export function parseText(text: string): ExtractedReportType {
  const reportDate = findReportDate(text);
  const metrics = walkLines(text);

  if (metrics.length < MIN_METRICS) {
    throw new Error(
      `gimap parser produced only ${metrics.length} metrics (expected ≥ ${MIN_METRICS}); falling back`,
    );
  }

  return ExtractedReport.parse({
    provider: PROVIDER,
    category: CATEGORY,
    reportDate,
    metrics,
  });
}

const DATE_RE = /Collected:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i;

function findReportDate(text: string): string | null {
  const m = text.match(DATE_RE);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

interface WalkState {
  panel: string | null;
  pendingAnalyte: string | null;
  pendingValueLine: { value: string; range: string } | null;
  // GI-MAP page 8 (SCFA/BCFA detail) prints two panels side-by-side via a
  // tab. When we detect a tab-split section header, we store the per-column
  // panel here so subsequent tab-split data rows route to the correct panel.
  // Cleared on the next single-column section header.
  columnPanels: string[] | null;
}

function walkLines(text: string): ExtractedMetric[] {
  const out: ExtractedMetric[] = [];
  const seen = new Set<string>();
  const state: WalkState = {
    panel: null,
    pendingAnalyte: null,
    pendingValueLine: null,
    columnPanels: null,
  };

  const lines = text.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (isNoiseLine(line)) continue;
    if (isUmbrellaBanner(line)) continue;
    if (isProseLine(line)) continue;

    // A multi-column row (left half | right half), tab-separated. Split
    // and process each half independently to keep page 5's resistance-
    // gene grid + page 8's SCFA/BCFA grid parseable.
    if (line.includes("\t")) {
      const halves = line.split(/\t+/).map((s) => s.trim()).filter(Boolean);
      if (halves.length >= 2) {
        const sections = halves.map((h) => findSection(h));
        if (sections.every((s) => s !== null)) {
          // Two-column section header — record both panels and set the
          // running panel to the leftmost one.
          state.columnPanels = sections.map((s) => s!.panel);
          state.panel = state.columnPanels[0];
          state.pendingAnalyte = null;
          state.pendingValueLine = null;
          continue;
        }
        // Two-column data row.
        for (let i = 0; i < halves.length; i++) {
          const colPanel = state.columnPanels?.[i] ?? state.panel;
          const savedPanel = state.panel;
          state.panel = colPanel ?? savedPanel;
          processLine(halves[i], state, out, seen);
          state.panel = savedPanel;
        }
        continue;
      }
    }

    processLine(line, state, out, seen);
  }

  return out;
}

function processLine(
  line: string,
  state: WalkState,
  out: ExtractedMetric[],
  seen: Set<string>,
): void {
  const section = findSection(line);
  if (section) {
    // A section line that ALSO contains data (e.g. a table-header line that
    // pdfjs collapsed onto one row). Strip the header words and try to parse
    // the remainder.
    state.panel = section.panel;
    state.columnPanels = null;
    state.pendingAnalyte = null;
    state.pendingValueLine = null;
    const remainder = line.replace(section.pattern, "").replace(/Result\s+Reference/i, "").trim();
    if (remainder.length === 0) return;
    line = remainder;
  }

  const tokens = tokenize(line);
  if (tokens.length === 0) return;

  if (isAnalyteOnlyRow(tokens)) {
    const analyte = tokens.join(" ").trim();
    if (state.pendingValueLine) {
      emit(out, seen, {
        panel: state.panel,
        analyte,
        valueRaw: state.pendingValueLine.value,
        rangeRaw: state.pendingValueLine.range,
      });
      state.pendingValueLine = null;
    } else {
      // Buffer; the next value-only line will pair with this.
      state.pendingAnalyte = analyte;
    }
    return;
  }

  if (isValueOnlyRow(tokens)) {
    // Last token is range; everything before is value (+flags).
    const range = tokens[tokens.length - 1];
    const value = tokens.slice(0, -1).join(" ");
    if (state.pendingAnalyte) {
      emit(out, seen, {
        panel: state.panel,
        analyte: state.pendingAnalyte,
        valueRaw: value,
        rangeRaw: range,
      });
      state.pendingAnalyte = null;
    } else {
      state.pendingValueLine = { value, range };
    }
    return;
  }

  // Full row: analyte … value … range.
  // Find the boundary at the first value-like token.
  const valueIdx = tokens.findIndex((t) => leadsWithValue([t]));
  if (valueIdx <= 0) return; // no value detected → skip
  const analyte = tokens.slice(0, valueIdx).join(" ").trim();
  const valueParts = tokens.slice(valueIdx, tokens.length - 1);
  const range = tokens[tokens.length - 1];
  const value = valueParts.join(" ");
  if (!analyte) return;

  emit(out, seen, {
    panel: state.panel,
    analyte,
    valueRaw: value,
    rangeRaw: range,
  });
  state.pendingAnalyte = null;
  state.pendingValueLine = null;
}

interface EmitInput {
  panel: string | null;
  analyte: string;
  valueRaw: string;
  rangeRaw: string;
}

function emit(
  out: ExtractedMetric[],
  seen: Set<string>,
  input: EmitInput,
): void {
  const name = cleanAnalyte(input.analyte);
  if (!name) return;

  // Suppress duplicate (same panel, same analyte) — guards against the
  // doubled-render artifacts that survive text-layer dedupe.
  const key = `${input.panel ?? ""}::${name.toLowerCase()}`;
  if (seen.has(key)) return;
  seen.add(key);

  const value = classifyValue(input.valueRaw);
  const range = parseRange(input.rangeRaw);

  out.push({
    name,
    panel: input.panel,
    valueNumeric: value.numeric,
    valueText: value.text,
    units: range.units,
    refLow: range.refLow,
    refHigh: range.refHigh,
    refText: range.refText,
    flag: value.flag,
  });
}

// Collapse consecutive duplicate words and dedupe a doubled prefix.
// Real-world examples this fixes:
//  - "Bacteroides fragilis Bacteroides fragilis" → "Bacteroides fragilis"
//  - "Eosinophil Activation Protein Eosinophil Activation Protein (EDN, EPX) EPX)"
//    → "Eosinophil Activation Protein (EDN, EPX)"
function cleanAnalyte(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim();

  // Symmetric doubling: "X X" where halves are identical.
  const halves = s.match(/^(.+?)\s+\1$/);
  if (halves) s = halves[1].trim();

  // Word-level: collapse a doubled prefix of any length, then collapse any
  // remaining adjacent-duplicate words.
  const words = s.split(/\s+/);
  for (let half = Math.floor(words.length / 2); half >= 1; half--) {
    const a = words.slice(0, half).join(" ");
    const b = words.slice(half, half * 2).join(" ");
    if (a === b) {
      const tail = words.slice(half * 2);
      s = [a, ...tail].join(" ").trim();
      break;
    }
  }
  const collapsed: string[] = [];
  for (const w of s.split(/\s+/)) {
    if (collapsed.length > 0 && collapsed[collapsed.length - 1] === w) continue;
    collapsed.push(w);
  }
  s = collapsed.join(" ").trim();

  // pdfjs sometimes splits a parenthesized abbreviation across two
  // text-layer rows ("Eosinophil Activation Protein (EDN," in one row,
  // "(EDN, EPX)" in the next). Drop a trailing unclosed-paren fragment so
  // the analyte name lands clean.
  if (/\([^)]*$/.test(s)) {
    s = s.replace(/\s*\([^)]*$/, "").trim();
  }

  // Trim trailing punctuation (commas, semicolons) the splitter may leave.
  s = s.replace(/[,:;]+$/, "").trim();

  return s;
}

const PROSE_LOWER_RE = /\b[a-z]{3,}\b/g;

// True if a line reads like a prose sentence, not a structured row.
// Used to skip explanatory captions ("microbes per gram, which equals…")
// that survive section/footer filtering. Five lowercase words (length ≥ 3)
// is a clear prose signal in this layout — even rows with multi-word taxa
// stay below 4 (e.g. "Faecalibacterium prausnitzii … org/g" → 3).
function isProseLine(line: string): boolean {
  const matches = line.match(PROSE_LOWER_RE);
  return matches !== null && matches.length >= 5;
}
