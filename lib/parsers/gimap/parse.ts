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
  // Pending row pieces. The parser fills them as lines arrive and emits
  // when all three are present. Layouts that hand us pieces in different
  // orders (e.g. page 8 Caproate is value/analyte/range on three separate
  // lines) all converge on the same pending-state model.
  pendingAnalyte: string | null;
  pendingValue: string | null;
  pendingRange: string | null;
  // analyte+value+range pair where value and range arrived together on
  // one line ("<dl  < 1.00e3" type rows). Distinct from pendingValue
  // because once we have the pair, only an analyte is missing.
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
    pendingValue: null,
    pendingRange: null,
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
          state.pendingValue = null;
          state.pendingRange = null;
          state.pendingValueLine = null;
          continue;
        }
        // [analyte] + [range] split — page 6 SCFA Summary (Acetate - %)
        // and bile-acid pages occasionally print the analyte+range on one
        // tab-split row and the value alone on the next. Buffer both and
        // pair with the next value-only line.
        if (halves.length === 2 && looksLikeAnalyteToken(halves[0]) && looksLikeRangeToken(halves[1])) {
          state.pendingAnalyte = halves[0];
          state.pendingRange = halves[1];
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
    state.pendingValue = null;
    state.pendingRange = null;
    state.pendingValueLine = null;
    // Strip the section name, the trailing "Result Reference" column
    // labels (with optional unit suffixes like "Result ng/g  Reference
    // ng/g"), and the "Abbreviation Conjugation**" header used in bile
    // acid tables. Whatever survives is real data on a section line.
    const remainder = line
      .replace(section.pattern, "")
      .replace(/Result(\s+\S+)?\s+Reference(\s+\S+)?/i, "")
      .replace(/Abbreviation\s+Conjugation\**/i, "")
      .trim();
    if (remainder.length === 0) return;
    line = remainder;
  }

  let tokens = tokenize(line);
  if (tokens.length === 0) return;

  // Bile-acid panels print [Analyte] [Abbreviation] [Conjugation U|C] [Result] [Reference].
  // Strip the abbreviation and (optional) conjugation columns so the rest
  // of the parser sees a clean [analyte, value, range] shape. The strip is
  // panel-aware so non-bile-acid rows are untouched.
  if (isBileAcidPanel(state.panel)) {
    tokens = stripBileAcidColumns(tokens, state.pendingAnalyte != null);
    if (tokens.length === 0) return;
  }

  // Single-token range line: "< 1.00e3", "7.15e-1 - 1.44e2", etc.
  // Could complete a pending {analyte + value + range} triple (page 8
  // Caproate) or be a stray range that we hold until both partners arrive.
  if (tokens.length === 1 && looksLikeRangeToken(tokens[0])) {
    state.pendingRange = tokens[0];
    tryEmitTriple(out, seen, state);
    return;
  }

  // [pendingAnalyte + pendingRange] paired with a value-only line. Accept
  // any value-like first token, including length-1 lines like "70.1 H".
  if (
    state.pendingAnalyte &&
    state.pendingRange &&
    leadsWithValue(tokens)
  ) {
    state.pendingValue = tokens.join(" ");
    tryEmitTriple(out, seen, state);
    return;
  }

  // Single-token value line: "6.68e-1", "70.1 H". On its own (no pending
  // state) we save it as pendingValue; the next analyte/range pair fills
  // out the triple.
  if (tokens.length === 1 && leadsWithValue(tokens)) {
    state.pendingValue = tokens[0];
    tryEmitTriple(out, seen, state);
    return;
  }

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
      state.pendingAnalyte = analyte;
      tryEmitTriple(out, seen, state);
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
  state.pendingValue = null;
  state.pendingRange = null;
  state.pendingValueLine = null;
}

function tryEmitTriple(
  out: ExtractedMetric[],
  seen: Set<string>,
  state: WalkState,
): void {
  if (state.pendingAnalyte && state.pendingValue && state.pendingRange) {
    emit(out, seen, {
      panel: state.panel,
      analyte: state.pendingAnalyte,
      valueRaw: state.pendingValue,
      rangeRaw: state.pendingRange,
    });
    state.pendingAnalyte = null;
    state.pendingValue = null;
    state.pendingRange = null;
  }
}

function isBileAcidPanel(panel: string | null): boolean {
  return panel === "Primary Bile Acids" || panel === "Secondary Bile Acids";
}

// In the bile-acid panels, strip the abbreviation column (e.g. "CDCA",
// "Total BA Primary") and the optional conjugation column ("U" / "C")
// from the token list. Two cases:
//  - Single-line row: analyte is at tokens[0], abbreviation immediately
//    before the value token. Strip from inside.
//  - Multi-line row (pendingAnalyte set on the previous line): abbreviation
//    is at tokens[0]. Strip from the front.
function stripBileAcidColumns(
  tokens: string[],
  hasPendingAnalyte: boolean,
): string[] {
  const valueIdx = tokens.findIndex((t) => leadsWithValue([t]));
  if (valueIdx < 0) return tokens;

  const result = [...tokens];
  let nameEnd = valueIdx;

  // Strip optional conjugation (single 'U' or 'C').
  if (
    nameEnd >= 1 &&
    (result[nameEnd - 1] === "U" || result[nameEnd - 1] === "C")
  ) {
    result.splice(nameEnd - 1, 1);
    nameEnd -= 1;
  }

  // Strip the abbreviation column.
  if (
    hasPendingAnalyte &&
    nameEnd >= 1 &&
    looksLikeBileAcidAbbreviation(result[0])
  ) {
    result.splice(0, 1);
  } else if (
    !hasPendingAnalyte &&
    nameEnd >= 2 &&
    looksLikeBileAcidAbbreviation(result[nameEnd - 1])
  ) {
    result.splice(nameEnd - 1, 1);
  }

  return result;
}

function looksLikeBileAcidAbbreviation(t: string): boolean {
  if (!t || t.length > 30) return false;
  // Multi-word: "Total BA Primary", "Total BA Secondary"
  if (/^Total BA (Primary|Secondary)$/.test(t)) return true;
  // Single token, mostly uppercase + digits + hyphens (CA, CDCA, GUDCA,
  // 12-KLCA, ISO-LCA, AlloIso-LCA, 3-oxoDCA).
  if (/\s/.test(t)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9\-*]*$/.test(t) && /[A-Z]/.test(t);
}

// True when a token is a likely standalone analyte name (multi-word, no
// digits, doesn't start with a value sigil).
function looksLikeAnalyteToken(t: string): boolean {
  if (!t) return false;
  if (leadsWithValue([t])) return false;
  if (/^[<>]/.test(t)) return false;
  if (/^\d/.test(t)) return false;
  return /[A-Za-z]/.test(t);
}

// True when a token is a standalone reference range (no analyte, no value).
// Examples: "< 1.00e3", "1.6e9 - 2.5e11", "38.3 - 68.0", "> 200".
function looksLikeRangeToken(t: string): boolean {
  if (!t) return false;
  if (/^[<>]\s*-?\d/.test(t)) return true;
  if (/^-?\d+\.?\d*(?:[eE][+-]?\d+)?\s*-\s*-?\d/.test(t)) return true;
  return false;
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

  // Drop rows where we recovered neither a numeric nor a qualitative
  // value. They're just a row name with no signal — typical for the
  // page-5 antibiotic resistance gene table when H. pylori is below
  // detection (gene presence isn't measured, so values are blank).
  // Better to omit than emit a ghost metric that pollutes /mappings.
  if (value.numeric == null && value.text == null) return;

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
