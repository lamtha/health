// Unit handling has two layers:
//
// 1. `canonicalUnit()` — string-level normalization. Collapses spelling and
//    notation variants for the same *quantity at the same scale* (mcg/µ/μ,
//    case, "(calc)" qualifiers, x10E3/uL ↔ Thousand/uL) to a single canonical
//    key. Used anywhere we compare units for equality; raw unit strings stay
//    on each row for display.
//
// 2. `getUnitConversion()` — per-canonical-metric numeric rescaling. When a
//    metric's providers report across genuinely different *scales* (e.g.
//    differential absolute counts in cells/µL vs k/µL), this returns the
//    multiplier to get every row onto one y-axis, plus the target display
//    unit. Callers preserve the original value + unit for the raw-data table;
//    only the plotted value is rescaled.
//
// Extend both as new collisions show up in real reports (the ingest warns on
// unmapped canonical mismatches; add an entry and re-render).

// --- Layer 1: string aliases -------------------------------------------------

// Character normalization: the micro sign U+00B5 and Greek small mu U+03BC
// render identically but are distinct codepoints; the superscript "²" on
// /1.73m² similarly. Collapse both into ASCII before alias lookup so one
// alias entry covers every spelling.
function normalizeUnitKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\u00b5/g, "u") // µ (micro sign) → u
    .replace(/\u03bc/g, "u") // μ (greek small mu) → u
    .replace(/\u00b2/g, "2"); // ² (superscript two) → 2
}

// Aliases map *normalized* keys to a canonical form. Every value on the right
// should be in normalized form so canonicalUnit() is idempotent.
const UNIT_ALIASES: Record<string, string> = {
  // --- GI-MAP qPCR: copies/g == org/g on a single-copy assay.
  "org/g": "copies/g",
  "organisms/g": "copies/g",

  // --- Micrograms: mcg == ug (after µ/μ→u normalization). Standardize on ug.
  "mcg/dl": "ug/dl",
  "mcg/g": "ug/g",
  "mcg/ml": "ug/ml",

  // --- "(calc)" qualifier is noise — calculated LDL/Non-HDL/Globulin are in
  // the same units as directly measured.
  "mg/dl (calc)": "mg/dl",
  "g/dl (calc)": "g/dl",

  // --- Enzyme units: 1 IU == 1 U for ALT/AST/Alk Phos/GGT.
  "iu/l": "u/l",

  // --- nanomol spelled out.
  "nanomol/l": "nmol/l",

  // --- eGFR: the "m2" / "m²" body-surface normalization is always implied.
  "ml/min/1.73m2": "ml/min/1.73",

  // --- TSH: numerically mIU/L ≡ μIU/mL (≡ uIU/mL after µ→u).
  "uiu/ml": "miu/l",

  // --- Thousand/Million per µL: "x10E3/uL" and "k/uL" and "Thousand/uL" are
  // three notations for the same scale. Same for 10E6 / M / Million.
  "x10e3/ul": "k/ul",
  "thousand/ul": "k/ul",
  "x10e6/ul": "m/ul",
  "million/ul": "m/ul",

  // --- "% by wt" is the weight-percent form some labs print for fatty-acid
  // fractions; the "by wt" qualifier is implicit for these assays.
  "% by wt": "%",
};

export function canonicalUnit(u: string | null | undefined): string | null {
  if (!u) return null;
  const key = normalizeUnitKey(u);
  if (key === "") return null;
  return UNIT_ALIASES[key] ?? key;
}

// --- Layer 2: per-metric numeric conversion ----------------------------------

interface MetricUnitSpec {
  // Unit label shown on the chart y-axis and stats when the conversion path
  // is taken. Free-form string (e.g. "k/µL", "µmol/L").
  displayUnit: string;
  // Canonical-unit key (what canonicalUnit() returns) → multiplier applied to
  // the value (and refLow/refHigh) to reach displayUnit. Rows whose canonical
  // unit is not in this map stay excluded (fail-loud, same as today's
  // behavior for metrics with no spec).
  factors: Record<string, number>;
}

// Keys are canonical metric names (canonical_metrics.canonical_name).
const METRIC_UNIT_CONVERSIONS: Record<string, MetricUnitSpec> = {
  // CBC absolute differentials: labs split between absolute counts
  // (cells/µL, typical 50–5000) and thousand-scaled (k/µL ≡ Thousand/µL ≡
  // x10E3/µL, typical 0.05–5). 1 cell/µL = 0.001 k/µL.
  "Basophils (Absolute)": {
    displayUnit: "k/µL",
    factors: { "k/ul": 1, "cells/ul": 0.001 },
  },
  "Eosinophils (Absolute)": {
    displayUnit: "k/µL",
    factors: { "k/ul": 1, "cells/ul": 0.001 },
  },
  "Lymphocytes (Absolute)": {
    displayUnit: "k/µL",
    factors: { "k/ul": 1, "cells/ul": 0.001 },
  },
  "Monocytes (Absolute)": {
    displayUnit: "k/µL",
    factors: { "k/ul": 1, "cells/ul": 0.001 },
  },
  "Neutrophils (Absolute)": {
    displayUnit: "k/µL",
    factors: { "k/ul": 1, "cells/ul": 0.001 },
  },

  // Homocysteine: most labs report µmol/L; one occurrence in nmol/L.
  // 1 nmol/L = 0.001 µmol/L.
  Homocysteine: {
    displayUnit: "µmol/L",
    factors: { "umol/l": 1, "nmol/l": 0.001 },
  },
};

export function getUnitConversion(
  canonicalMetricName: string | null | undefined,
  rawUnit: string | null | undefined,
): { displayUnit: string; factor: number } | null {
  if (!canonicalMetricName) return null;
  const spec = METRIC_UNIT_CONVERSIONS[canonicalMetricName];
  if (!spec) return null;
  const key = canonicalUnit(rawUnit);
  if (!key) return null;
  const factor = spec.factors[key];
  if (factor === undefined) return null;
  return { displayUnit: spec.displayUnit, factor };
}

export function hasMetricUnitSpec(
  canonicalMetricName: string | null | undefined,
): boolean {
  if (!canonicalMetricName) return false;
  return canonicalMetricName in METRIC_UNIT_CONVERSIONS;
}
