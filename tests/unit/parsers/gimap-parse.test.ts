import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseText } from "@/lib/parsers/gimap";

const fixturesDir = path.resolve(__dirname, "../../fixtures/gimap");

function fixture(name: string): string {
  return fs.readFileSync(path.join(fixturesDir, name), "utf8");
}

describe("gimap parseText (2025-12 fixture)", () => {
  const report = parseText(fixture("2025-12.txt"));

  it("identifies provider and category", () => {
    expect(report.provider).toBe("gi-map");
    expect(report.category).toBe("gi");
  });

  it("extracts the collection date", () => {
    expect(report.reportDate).toBe("2025-12-02");
  });

  it("yields a clinically meaningful number of metrics", () => {
    expect(report.metrics.length).toBeGreaterThanOrEqual(100);
  });

  it("captures Calprotectin as a numeric inflammation marker", () => {
    const m = report.metrics.find((x) => x.name === "Calprotectin");
    expect(m).toBeDefined();
    expect(m?.valueNumeric).toBe(40);
    expect(m?.units).toBe("ug/g");
    expect(m?.refHigh).toBe(173);
  });

  it("captures Akkermansia muciniphila with a bounded reference range", () => {
    const m = report.metrics.find(
      (x) => x.name === "Akkermansia muciniphila",
    );
    expect(m).toBeDefined();
    expect(m?.valueNumeric).toBeCloseTo(2.92e5, 0);
    expect(m?.refLow).toBeCloseTo(1.0e1, 1);
    expect(m?.refHigh).toBeCloseTo(8.2e6, 0);
  });

  it("captures Secretory IgA in the immune-response panel", () => {
    const m = report.metrics.find((x) => x.name === "Secretory IgA");
    expect(m).toBeDefined();
    expect(m?.panel).toContain("Immune Response");
    expect(m?.valueNumeric).toBe(1574);
    expect(m?.refLow).toBe(510);
    expect(m?.refHigh).toBe(2010);
  });

  it("represents below-detection rows as valueText '<dl' with null valueNumeric", () => {
    const campy = report.metrics.find((x) => x.name === "Campylobacter");
    expect(campy).toBeDefined();
    expect(campy?.valueNumeric).toBeNull();
    expect(campy?.valueText).toBe("<dl");
  });

  it("represents 'Not Detected' worm rows as text-valued", () => {
    const worm = report.metrics.find((x) => x.name === "Ascaris lumbricoides");
    expect(worm).toBeDefined();
    expect(worm?.valueNumeric).toBeNull();
    expect(worm?.valueText).toBe("Not Detected");
  });

  it("flags Streptococcus spp. as high", () => {
    const m = report.metrics.find((x) => x.name === "Streptococcus spp.");
    expect(m).toBeDefined();
    expect(m?.flag).toBe("high");
    expect(m?.valueNumeric).toBeCloseTo(5.88e3, 0);
  });

  it("captures Zonulin (Add-On Tests) with the correct flag and units", () => {
    const m = report.metrics.find((x) => x.name === "Zonulin");
    expect(m).toBeDefined();
    expect(m?.valueNumeric).toBeCloseTo(272.1, 1);
    expect(m?.units).toBe("ng/g");
    expect(m?.flag).toBe("high");
  });

  it("routes SCFA detail rows to the Short Chain Fatty Acids panel", () => {
    const acetate = report.metrics.find(
      (x) => x.name === "Acetate" && x.panel?.includes("Short Chain Fatty Acids"),
    );
    expect(acetate).toBeDefined();
    expect(acetate?.valueNumeric).toBeCloseTo(3.10e3, 0);
    expect(acetate?.flag).toBe("low");
  });

  it("routes BCFA detail rows to the Branched Chain Fatty Acids panel", () => {
    const iso = report.metrics.find(
      (x) => x.name === "Iso-butyrate" && x.panel?.includes("Branched"),
    );
    expect(iso).toBeDefined();
    expect(iso?.valueNumeric).toBeCloseTo(1.85e2, 0);
  });

  it("does not emit explanatory captions as metrics", () => {
    const noise = report.metrics.find((x) =>
      x.name.toLowerCase().includes("microbes per gram"),
    );
    expect(noise).toBeUndefined();
  });

  it("does not duplicate a metric when its row was rendered with bold doubling", () => {
    const occurrences = report.metrics.filter(
      (x) => x.name === "Bacteroides fragilis",
    );
    expect(occurrences.length).toBe(1);
  });

  it("captures Helicobacter pylori (regression: banner pattern was filtering the data row)", () => {
    const m = report.metrics.find((x) => x.name === "Helicobacter pylori");
    expect(m).toBeDefined();
    expect(m?.valueNumeric).toBeCloseTo(1.91e2, 0);
    expect(m?.panel).toContain("Virulence Factors");
  });

  it("captures page-8 Caproate (regression: 3-line value/analyte/range layout)", () => {
    const m = report.metrics.find(
      (x) =>
        x.name === "Caproate" && x.panel?.includes("Short Chain Fatty Acids"),
    );
    expect(m).toBeDefined();
    expect(m?.valueNumeric).toBeCloseTo(0.668, 2);
  });

  it("captures both Acetate rows distinctly (page 6 % and page 8 μg/g)", () => {
    const summaryAcetate = report.metrics.find(
      (x) => x.name === "Acetate - %" && x.panel === "SCFA Summary",
    );
    const detailAcetate = report.metrics.find(
      (x) => x.name === "Acetate" && x.panel?.includes("Short Chain Fatty Acids"),
    );
    expect(summaryAcetate?.valueNumeric).toBeCloseTo(70.1, 1);
    expect(detailAcetate?.valueNumeric).toBeCloseTo(3.10e3, 0);
  });

  it("strips Abbreviation + Conjugation columns from bile-acid analyte names", () => {
    // Page-7 bile-acid table has [Analyte] [Abbreviation] [Conjugation U|C]
    // [Result] [Reference] columns. Analyte should land clean.
    const cholic = report.metrics.find((x) => x.name === "Cholic Acid");
    expect(cholic).toBeDefined();
    expect(cholic?.panel).toBe("Primary Bile Acids");
    expect(cholic?.valueNumeric).toBeCloseTo(3.99e2, 0);

    // Multi-line layout: analyte alone on one line, [abbreviation conjugation
    // value range] on the next. Strip should still produce the clean name.
    const tcdca = report.metrics.find(
      (x) => x.name === "Taurochenodeoxycholic Acid",
    );
    expect(tcdca).toBeDefined();
    expect(tcdca?.valueNumeric).toBeCloseTo(43.9, 1);
  });

  it("drops H. pylori antibiotic resistance gene rows that have no recoverable value", () => {
    // When H. pylori is below detection, the gene-resistance grid (page 5)
    // is all N/A. The class-level rows (Amoxicillin, Clarithromycin, etc.)
    // come through with valueText="N/A"; the gene-level rows have no
    // value at all and should NOT be emitted.
    const ghosts = report.metrics.filter((x) =>
      ["PBP1A T556S", "A2142G", "gyrA N87K", "A926G"].includes(x.name),
    );
    expect(ghosts).toHaveLength(0);
  });
});

describe("gimap parseText (2024-12 fixture)", () => {
  const report = parseText(fixture("2024-12.txt"));

  it("identifies provider and category", () => {
    expect(report.provider).toBe("gi-map");
    expect(report.category).toBe("gi");
  });

  it("extracts the collection date", () => {
    expect(report.reportDate).toBe("2024-11-22");
  });

  it("yields a clinically meaningful number of metrics", () => {
    // Older vintage without bile-acid / SCFA detail panels — still ≥ 80.
    expect(report.metrics.length).toBeGreaterThanOrEqual(80);
  });

  it("captures Calprotectin", () => {
    const m = report.metrics.find((x) => x.name === "Calprotectin");
    expect(m).toBeDefined();
    expect(m?.valueNumeric).not.toBeNull();
  });
});
