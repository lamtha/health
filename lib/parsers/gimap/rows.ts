// Token classification + range parsing helpers for GI-MAP rows.
//
// A "row" is the line text after pdf-text reconstruction; tokens are
// usually separated by 2+ spaces or a tab. Inline doubling (e.g. the
// reference range printed twice with a units glob between) is handled
// here rather than upstream so the text-extractor stays generic.

const QUALITATIVE_LITERALS: Record<string, string> = {
  "<dl": "<dl",
  "<dl.": "<dl",
  "not detected": "Not Detected",
  "not detected.": "Not Detected",
  detected: "Detected",
  positive: "Positive",
  negative: "Negative",
  equivocal: "Equivocal",
  present: "Present",
  absent: "Absent",
  "n/a": "N/A",
};

// Units we recognize inline so we can split them off a glued range like
// "1.6e9 - 2.5e11org/g". Leading boundary uses a lookbehind for non-letter
// rather than `\b` because GI-MAP often glues units onto a digit (`8.2e6org/g`)
// and `\b` doesn't match between two word chars. Order: longer matches first.
const UNIT_PATTERNS: Array<[string, RegExp]> = [
  ["copies/g", /(?<![A-Za-z])copies\/g\b/i],
  ["cells/g", /(?<![A-Za-z])cells\/g\b/i],
  ["cfu/g", /(?<![A-Za-z])cfu\/g\b/i],
  ["org/g", /(?<![A-Za-z])org\/g\b/i],
  ["ng/mL", /(?<![A-Za-z])ng\/mL\b/i],
  ["mcg/g", /(?<![A-Za-z])mcg\/g\b/i],
  ["μg/g", /(?<![A-Za-z])μg\/g\b/i],
  ["ng/g", /(?<![A-Za-z])ng\/g\b/i],
  ["ug/g", /(?<![A-Za-z])ug\/g\b/i],
  ["U/mL", /(?<![A-Za-z])U\/mL\b/i],
  ["U/L", /(?<![A-Za-z])U\/L\b/i],
  ["%", /(?<!\w)%/],
];

const SCI_NUM_RE = /^-?\d+\.?\d*(?:[eE][+-]?\d+)?$/;

export interface ValueResult {
  numeric: number | null;
  text: string | null;
  flag: "high" | "low" | "ok" | null;
}

export function classifyValue(token: string): ValueResult {
  const t = token.trim();
  if (!t) return { numeric: null, text: null, flag: null };

  // Strip every flag indicator we can find ("H", "L", "↑", "↓", "High",
  // "Low") and remember them. Some rows print both a word and an arrow
  // ("High ↑"); some print the flag before the value ("H 6.46e8").
  let flag: "high" | "low" | null = null;
  let stripped = t;
  const flagRe = /(?:^|\s)(High|Low|H|L)(?=\s|$)|↑|↓/gi;
  for (const m of stripped.matchAll(flagRe)) {
    const word = (m[1] ?? m[0]).toLowerCase();
    if (word === "h" || word === "high" || word === "↑") flag = "high";
    else if (word === "l" || word === "low" || word === "↓") flag = "low";
  }
  stripped = stripped.replace(flagRe, " ").replace(/\s+/g, " ").trim();

  // Below detection takes precedence over a numeric token that may co-exist
  // (e.g. "<1.00e2 <dl L" — the printed numeric is the LOD itself, not the
  // measurement). Treat the row as below detection.
  if (/<\s*dl\b/i.test(stripped)) {
    return { numeric: null, text: "<dl", flag };
  }

  const lower = stripped.toLowerCase();
  if (QUALITATIVE_LITERALS[lower] !== undefined) {
    return { numeric: null, text: QUALITATIVE_LITERALS[lower], flag };
  }

  if (SCI_NUM_RE.test(stripped)) {
    return { numeric: parseFloat(stripped), text: null, flag };
  }

  // Token like ">750" — a bounded numeric the parser should treat as numeric.
  const ineq = stripped.match(/^([<>])\s*(-?\d+\.?\d*(?:[eE][+-]?\d+)?)$/);
  if (ineq) {
    return { numeric: parseFloat(ineq[2]), text: stripped, flag };
  }

  return { numeric: null, text: stripped, flag };
}

export interface RangeResult {
  refLow: number | null;
  refHigh: number | null;
  refText: string | null;
  units: string | null;
}

export function parseRange(token: string): RangeResult {
  let raw = token.trim();
  if (!raw) return { refLow: null, refHigh: null, refText: null, units: null };

  // Pull out units glued anywhere in the token. First match wins.
  let units: string | null = null;
  for (const [name, re] of UNIT_PATTERNS) {
    if (re.test(raw)) {
      units = name;
      raw = raw.replace(re, " ").replace(/\s+/g, " ").trim();
      break;
    }
  }

  // Collapse the doubled-range artifact: "1.6e9 - 2.5e11 1.6e9 - 2.5e11" → "1.6e9 - 2.5e11"
  // We do this after stripping units, since the units token can fall between
  // the two halves.
  const halves = raw.match(/^(.+?)\s+\1$/);
  if (halves) raw = halves[1].trim();

  const refText = raw || null;

  // Qualitative range
  const lower = raw.toLowerCase();
  if (lower in QUALITATIVE_LITERALS) {
    return { refLow: null, refHigh: null, refText, units };
  }

  // < X
  const lt = raw.match(/^<\s*(-?\d+\.?\d*(?:[eE][+-]?\d+)?)$/);
  if (lt) return { refLow: null, refHigh: parseFloat(lt[1]), refText, units };

  // > X
  const gt = raw.match(/^>\s*(-?\d+\.?\d*(?:[eE][+-]?\d+)?)$/);
  if (gt) return { refLow: parseFloat(gt[1]), refHigh: null, refText, units };

  // X - Y (allow scientific notation; the dash has spaces around it after
  // the doubling-collapse step).
  const range = raw.match(
    /^(-?\d+\.?\d*(?:[eE][+-]?\d+)?)\s*-\s*(-?\d+\.?\d*(?:[eE][+-]?\d+)?)$/,
  );
  if (range) {
    return {
      refLow: parseFloat(range[1]),
      refHigh: parseFloat(range[2]),
      refText,
      units,
    };
  }

  return { refLow: null, refHigh: null, refText, units };
}

// Split a line into tokens at runs of 2+ spaces or tabs.
export function tokenize(line: string): string[] {
  return line
    .split(/\t+|\s{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// True if the leading token of a row is a value, not an analyte name.
// We accept tokens that *start* with a value-like pattern, since GI-MAP
// often glues a flag indicator onto the value ("272.1 H", "5.88e3 High ↑").
export function leadsWithValue(tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const t = tokens[0].trim();
  if (/^<\s*dl(?:\s+(?:H|L|High|Low|↑|↓))?\s*$/i.test(t)) return true;
  if (/^[<>]\s*-?\d/.test(t)) return true;
  if (/^-?\d+\.?\d*(?:[eE][+-]?\d+)?(?:\s+(?:H|L|High|Low|↑|↓))*\s*$/.test(t))
    return true;
  // Qualitative literals — exact match or with trailing flag.
  const lower = t.toLowerCase().replace(/\s+(h|l|high|low|↑|↓)\s*$/i, "").trim();
  if (QUALITATIVE_LITERALS[lower] !== undefined) return true;
  return false;
}

// True if a row carries only a value + range (no analyte). Requires ≥ 2
// tokens — a single value-like token without a range is more likely a stray
// fragment from a multi-column page than a real continuation row.
export function isValueOnlyRow(tokens: string[]): boolean {
  if (tokens.length < 2 || tokens.length > 4) return false;
  return leadsWithValue(tokens);
}

// True if the row is a single analyte name (no values at all).
export function isAnalyteOnlyRow(tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  for (const t of tokens) {
    if (leadsWithValue([t])) return false;
    // A range / "< X" alone in a token also disqualifies.
    if (/^[<>]\s*\d/.test(t)) return false;
    // Reference-range without a leading inequality sign: "1.6e9 - 2.5e11"
    if (/^\d+\.?\d*(?:[eE][+-]?\d+)?\s*-\s*\d/.test(t)) return false;
  }
  return true;
}
