import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  canonicalMetrics,
  metrics as metricsTable,
  reports,
} from "@/db/schema";
import { getMetricSeries } from "@/lib/metric-series";

// ─── Fixtures ────────────────────────────────────────────────────────────

function canonicalIdFor(name: string): number {
  const row = db
    .select({ id: canonicalMetrics.id })
    .from(canonicalMetrics)
    .where(eq(canonicalMetrics.canonicalName, name))
    .get();
  if (!row) throw new Error(`canonical "${name}" not seeded`);
  return row.id;
}

function seedReport(args: {
  provider: string;
  date: string;
  category?: string;
}): number {
  const [row] = db
    .insert(reports)
    .values({
      filePath: `/tmp/${args.provider}-${args.date}.pdf`,
      fileHash: `hash-${args.provider}-${args.date}-${Math.random()}`,
      provider: args.provider,
      category: args.category ?? "blood",
      reportDate: args.date,
    })
    .returning({ id: reports.id })
    .all();
  return row.id;
}

function seedMetric(args: {
  reportId: number;
  name: string;
  canonicalMetricId: number;
  value: number;
  units: string;
  refLow?: number;
  refHigh?: number;
  flag?: "high" | "low" | "ok";
}) {
  db.insert(metricsTable)
    .values({
      reportId: args.reportId,
      name: args.name,
      canonicalMetricId: args.canonicalMetricId,
      valueNumeric: args.value,
      units: args.units,
      refLow: args.refLow ?? null,
      refHigh: args.refHigh ?? null,
      flag: args.flag ?? null,
    })
    .run();
}

function clearAll() {
  // Cascades delete metrics via FK.
  db.delete(reports).run();
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("getMetricSeries unit conversion", () => {
  afterEach(() => {
    clearAll();
  });

  it("rescales cells/uL rows to k/µL for Basophils and preserves originals", () => {
    const cid = canonicalIdFor("Basophils (Absolute)");

    const rLabcorp = seedReport({ provider: "labcorp", date: "2024-01-10" });
    const rQuest = seedReport({ provider: "quest", date: "2024-06-20" });

    // Labcorp reports in cells/uL; Quest reports in x10E3/uL.
    seedMetric({
      reportId: rLabcorp,
      name: "Basophils (Absolute)",
      canonicalMetricId: cid,
      value: 50, // cells/uL → 0.050 k/µL
      units: "cells/uL",
      refLow: 0,
      refHigh: 200,
    });
    seedMetric({
      reportId: rQuest,
      name: "Basophils (Absolute)",
      canonicalMetricId: cid,
      value: 0.04, // x10E3/uL ≡ k/µL, factor 1
      units: "x10E3/uL",
      refLow: 0,
      refHigh: 0.2,
    });

    const data = getMetricSeries("Basophils (Absolute)");
    expect(data).not.toBeNull();
    if (!data) return;

    // Both rows plotted, both in the spec's display unit.
    expect(data.points).toHaveLength(2);
    expect(data.units).toBe("k/\u00b5L");
    expect(data.excludedForUnits).toHaveLength(0);

    const labcorpPt = data.points.find((p) => p.provider === "labcorp");
    const questPt = data.points.find((p) => p.provider === "quest");
    expect(labcorpPt).toBeDefined();
    expect(questPt).toBeDefined();

    // Labcorp value rescaled cells/uL → k/µL (÷1000), original preserved.
    expect(labcorpPt!.value).toBeCloseTo(0.05, 10);
    expect(labcorpPt!.originalValue).toBe(50);
    expect(labcorpPt!.units).toBe("cells/uL");
    expect(labcorpPt!.refLow).toBe(0);
    expect(labcorpPt!.refHigh).toBeCloseTo(0.2, 10);
    expect(labcorpPt!.originalRefHigh).toBe(200);

    // Quest value passes through with factor 1, original equals plotted.
    expect(questPt!.value).toBeCloseTo(0.04, 10);
    expect(questPt!.originalValue).toBe(0.04);
    expect(questPt!.units).toBe("x10E3/uL");

    // Conversion banner fields populated correctly.
    expect(data.convertedFromUnits).toEqual(["cells/uL"]);
    expect(data.unitsMismatch).toBe(true);

    // pointsAll mirrors points when nothing excluded.
    expect(data.pointsAll).toHaveLength(2);
  });

  it("excludes rows with no known conversion (e.g. % instead of k/µL)", () => {
    const cid = canonicalIdFor("Basophils (Absolute)");

    const r1 = seedReport({ provider: "labcorp", date: "2024-01-10" });
    const r2 = seedReport({ provider: "function", date: "2024-03-15" });

    seedMetric({
      reportId: r1,
      name: "Basophils (Absolute)",
      canonicalMetricId: cid,
      value: 0.04,
      units: "k/uL",
    });
    seedMetric({
      reportId: r2,
      name: "Basophils (Absolute)",
      canonicalMetricId: cid,
      value: 0.8, // percentage — not the right assay for "Absolute"
      units: "%",
    });

    const data = getMetricSeries("Basophils (Absolute)");
    expect(data).not.toBeNull();
    if (!data) return;

    expect(data.points).toHaveLength(1);
    expect(data.excludedForUnits).toHaveLength(1);
    expect(data.excludedForUnits[0].units).toBe("%");
    expect(data.pointsAll).toHaveLength(2);
    expect(data.convertedFromUnits).toEqual([]); // k/uL was factor-1, not a conversion
  });

  it("falls back to dominant-unit behavior when no spec exists", () => {
    // WBC currently has no conversion spec; behavior should match legacy.
    const cid = canonicalIdFor("White Blood Cells");

    const r1 = seedReport({ provider: "labcorp", date: "2024-01-10" });
    const r2 = seedReport({ provider: "labcorp", date: "2024-06-20" });
    const r3 = seedReport({
      provider: "labcorp",
      date: "2024-09-05",
      category: "urine",
    });

    seedMetric({
      reportId: r1,
      name: "White Blood Cells",
      canonicalMetricId: cid,
      value: 5.5,
      units: "Thousand/uL",
    });
    seedMetric({
      reportId: r2,
      name: "White Blood Cells",
      canonicalMetricId: cid,
      value: 6.2,
      units: "x10E3/uL",
    });
    seedMetric({
      reportId: r3,
      name: "White Blood Cells",
      canonicalMetricId: cid,
      value: 2,
      units: "/HPF",
    });

    const data = getMetricSeries("White Blood Cells");
    expect(data).not.toBeNull();
    if (!data) return;

    // Two Thousand/uL-family rows kept (they alias to the same canonical),
    // one /HPF row excluded (different quantity, no spec to convert).
    expect(data.points).toHaveLength(2);
    expect(data.excludedForUnits).toHaveLength(1);
    expect(data.excludedForUnits[0].units).toBe("/HPF");
    expect(data.unitsMismatch).toBe(true);
    expect(data.convertedFromUnits).toEqual([]);
    // No conversion — originalValue should equal value on every point.
    for (const p of data.points) {
      expect(p.originalValue).toBe(p.value);
    }
  });

  it("passes through cleanly when all rows are already in one canonical unit", () => {
    const cid = canonicalIdFor("Homocysteine");

    const r1 = seedReport({ provider: "labcorp", date: "2024-01-10" });
    const r2 = seedReport({ provider: "quest", date: "2024-06-20" });

    seedMetric({
      reportId: r1,
      name: "Homocysteine",
      canonicalMetricId: cid,
      value: 8.0,
      units: "umol/L",
    });
    seedMetric({
      reportId: r2,
      name: "Homocysteine",
      canonicalMetricId: cid,
      value: 9.2,
      units: "\u00b5mol/L",
    });

    const data = getMetricSeries("Homocysteine");
    expect(data).not.toBeNull();
    if (!data) return;

    expect(data.points).toHaveLength(2);
    expect(data.excludedForUnits).toHaveLength(0);
    expect(data.convertedFromUnits).toEqual([]);
    expect(data.unitsMismatch).toBe(false);
    for (const p of data.points) {
      expect(p.value).toBe(p.originalValue);
    }
  });
});
