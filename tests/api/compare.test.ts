import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  canonicalMetrics,
  metrics as metricsTable,
  reports,
} from "@/db/schema";
import { getCompareSeries } from "@/lib/compare";

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
      category: args.category ?? "gi",
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
  value: number | null;
  valueText?: string | null;
  units?: string | null;
}) {
  db.insert(metricsTable)
    .values({
      reportId: args.reportId,
      name: args.name,
      canonicalMetricId: args.canonicalMetricId,
      valueNumeric: args.value,
      valueText: args.valueText ?? null,
      units: args.units ?? null,
    })
    .run();
}

function clearAll() {
  db.delete(reports).run();
}

describe("getCompareSeries nonNumericCount", () => {
  afterEach(() => {
    clearAll();
  });

  it("counts rows with null valueNumeric so the UI can warn instead of silently empty", () => {
    const cid = canonicalIdFor("Candida spp.");

    const r1 = seedReport({ provider: "gi-map", date: "2024-01-31" });
    const r2 = seedReport({ provider: "gi-map", date: "2024-11-22" });
    const r3 = seedReport({ provider: "gut-zoomer", date: "2025-12-03" });

    // All three are below-detection-limit rows — no numeric value.
    seedMetric({
      reportId: r1,
      name: "Candida spp.",
      canonicalMetricId: cid,
      value: null,
      valueText: "<dl",
      units: "org/g",
    });
    seedMetric({
      reportId: r2,
      name: "Candida spp.",
      canonicalMetricId: cid,
      value: null,
      valueText: "<dl",
      units: "copies/g",
    });
    seedMetric({
      reportId: r3,
      name: "Candida spp.",
      canonicalMetricId: cid,
      value: null,
      valueText: "<1e1",
      units: "copies/µL",
    });

    const result = getCompareSeries([cid]);
    expect(result.series).toHaveLength(1);
    const s = result.series[0];
    expect(s.points).toHaveLength(0);
    expect(s.nonNumericCount).toBe(3);
    expect(s.latest).toBeNull();
  });

  it("reports numeric and non-numeric counts independently when both are present", () => {
    const cid = canonicalIdFor("Candida albicans");

    const r1 = seedReport({ provider: "gut-zoomer", date: "2025-12-03" });
    const r2 = seedReport({ provider: "gi-map", date: "2025-05-16" });
    const r3 = seedReport({ provider: "gi-map", date: "2025-08-26" });

    seedMetric({
      reportId: r1,
      name: "Candida albicans",
      canonicalMetricId: cid,
      value: 12.5,
      units: "copies/µL",
    });
    seedMetric({
      reportId: r2,
      name: "Candida albicans",
      canonicalMetricId: cid,
      value: null,
      valueText: "<dl",
      units: "copies/g",
    });
    seedMetric({
      reportId: r3,
      name: "Candida albicans",
      canonicalMetricId: cid,
      value: null,
      valueText: "<dl",
      units: "copies/g",
    });

    const s = getCompareSeries([cid]).series[0];
    expect(s.points).toHaveLength(1);
    expect(s.points[0].value).toBe(12.5);
    expect(s.nonNumericCount).toBe(2);
  });

  it("is zero when every observation has a numeric value", () => {
    const cid = canonicalIdFor("Candida krusei");

    const r1 = seedReport({ provider: "gut-zoomer", date: "2025-12-03" });
    seedMetric({
      reportId: r1,
      name: "Candida krusei",
      canonicalMetricId: cid,
      value: 13.1,
    });

    const s = getCompareSeries([cid]).series[0];
    expect(s.points).toHaveLength(1);
    expect(s.nonNumericCount).toBe(0);
  });
});
