import { describe, expect, it } from "vitest";

import {
  canonicalUnit,
  getUnitConversion,
  hasMetricUnitSpec,
} from "@/lib/units";

describe("canonicalUnit", () => {
  it("returns null for null / empty / whitespace", () => {
    expect(canonicalUnit(null)).toBeNull();
    expect(canonicalUnit(undefined)).toBeNull();
    expect(canonicalUnit("")).toBeNull();
    expect(canonicalUnit("   ")).toBeNull();
  });

  it("lowercases input", () => {
    expect(canonicalUnit("MG/DL")).toBe("mg/dl");
    expect(canonicalUnit("mg/DL")).toBe("mg/dl");
  });

  it("normalizes micro-sign (U+00B5) and greek mu (U+03BC) to ASCII 'u'", () => {
    expect(canonicalUnit("\u00b5g/dL")).toBe("ug/dl");
    expect(canonicalUnit("\u03bcg/dL")).toBe("ug/dl");
    expect(canonicalUnit("\u00b5mol/L")).toBe("umol/l");
    expect(canonicalUnit("\u03bcmol/L")).toBe("umol/l");
  });

  it("normalizes superscript 2 to plain '2' for eGFR units", () => {
    expect(canonicalUnit("mL/min/1.73m\u00b2")).toBe("ml/min/1.73");
    expect(canonicalUnit("mL/min/1.73m2")).toBe("ml/min/1.73");
    expect(canonicalUnit("mL/min/1.73")).toBe("ml/min/1.73");
  });

  it("treats mcg/ug/µg/μg as the same microgram unit", () => {
    const all = [
      canonicalUnit("mcg/dL"),
      canonicalUnit("ug/dL"),
      canonicalUnit("\u00b5g/dL"),
      canonicalUnit("\u03bcg/dL"),
    ];
    expect(new Set(all).size).toBe(1);
  });

  it("collapses '(calc)' qualifier onto the same unit", () => {
    expect(canonicalUnit("mg/dL (calc)")).toBe(canonicalUnit("mg/dL"));
    expect(canonicalUnit("g/dL (calc)")).toBe(canonicalUnit("g/dL"));
  });

  it("equates IU/L and U/L for enzymes", () => {
    expect(canonicalUnit("IU/L")).toBe(canonicalUnit("U/L"));
  });

  it("equates Thousand/uL, x10E3/uL, and k/uL", () => {
    expect(canonicalUnit("Thousand/uL")).toBe(canonicalUnit("x10E3/uL"));
    expect(canonicalUnit("Thousand/uL")).toBe(canonicalUnit("k/uL"));
    expect(canonicalUnit("Thousand/uL")).toBe(canonicalUnit("k/\u00b5L"));
  });

  it("equates Million/uL and x10E6/uL", () => {
    expect(canonicalUnit("Million/uL")).toBe(canonicalUnit("x10E6/uL"));
  });

  it("equates nanomol/L and nmol/L", () => {
    expect(canonicalUnit("nanomol/L")).toBe(canonicalUnit("nmol/L"));
  });

  it("equates mIU/L and uIU/mL for TSH", () => {
    expect(canonicalUnit("mIU/L")).toBe(canonicalUnit("uIU/mL"));
  });

  it("keeps genuinely different units apart", () => {
    // /HPF (urine microscopy) is not the same as Thousand/uL (blood CBC).
    expect(canonicalUnit("/HPF")).not.toBe(canonicalUnit("Thousand/uL"));
    // copies/g (per gram stool) is not the same as copies/µL (per microliter).
    expect(canonicalUnit("copies/g")).not.toBe(canonicalUnit("copies/\u00b5L"));
  });

  it("preserves the existing org/g ↔ copies/g alias", () => {
    expect(canonicalUnit("org/g")).toBe(canonicalUnit("copies/g"));
    expect(canonicalUnit("organisms/g")).toBe(canonicalUnit("copies/g"));
  });
});

describe("hasMetricUnitSpec", () => {
  it("is true for metrics with a conversion entry", () => {
    expect(hasMetricUnitSpec("Basophils (Absolute)")).toBe(true);
    expect(hasMetricUnitSpec("Homocysteine")).toBe(true);
  });

  it("is false for metrics without one", () => {
    expect(hasMetricUnitSpec("White Blood Cells")).toBe(false);
    expect(hasMetricUnitSpec("Not A Real Metric")).toBe(false);
  });

  it("is false for null / undefined", () => {
    expect(hasMetricUnitSpec(null)).toBe(false);
    expect(hasMetricUnitSpec(undefined)).toBe(false);
  });
});

describe("getUnitConversion", () => {
  it("returns null when the metric has no spec", () => {
    expect(getUnitConversion("White Blood Cells", "Thousand/uL")).toBeNull();
  });

  it("returns null when the unit is not in the spec's factor map", () => {
    // Basophils has factors for k/uL and cells/uL, nothing else.
    expect(getUnitConversion("Basophils (Absolute)", "%")).toBeNull();
    expect(getUnitConversion("Basophils (Absolute)", null)).toBeNull();
  });

  it("returns factor=1 when the unit is already at display scale", () => {
    const conv = getUnitConversion("Basophils (Absolute)", "k/\u00b5L");
    expect(conv).not.toBeNull();
    expect(conv!.factor).toBe(1);
    expect(conv!.displayUnit).toBe("k/\u00b5L");
  });

  it("rescales cells/uL → k/µL for absolute differentials (×0.001)", () => {
    for (const metric of [
      "Basophils (Absolute)",
      "Eosinophils (Absolute)",
      "Lymphocytes (Absolute)",
      "Monocytes (Absolute)",
      "Neutrophils (Absolute)",
    ]) {
      const conv = getUnitConversion(metric, "cells/uL");
      expect(conv, metric).not.toBeNull();
      expect(conv!.factor).toBe(0.001);
      expect(conv!.displayUnit).toBe("k/\u00b5L");
    }
  });

  it("rescales nmol/L → µmol/L for Homocysteine (×0.001)", () => {
    const conv = getUnitConversion("Homocysteine", "nmol/L");
    expect(conv).not.toBeNull();
    expect(conv!.factor).toBe(0.001);
    expect(conv!.displayUnit).toBe("\u00b5mol/L");
  });

  it("applies to aliased inputs (nanomol/L routes to the nmol/L factor)", () => {
    const conv = getUnitConversion("Homocysteine", "nanomol/L");
    expect(conv).not.toBeNull();
    expect(conv!.factor).toBe(0.001);
  });

  it("applies to Thousand/uL and x10E3/uL through the k/uL alias", () => {
    // Both alias to k/ul (factor 1) after canonicalization.
    const a = getUnitConversion("Lymphocytes (Absolute)", "Thousand/uL");
    const b = getUnitConversion("Lymphocytes (Absolute)", "x10E3/uL");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.factor).toBe(1);
    expect(b!.factor).toBe(1);
  });
});
