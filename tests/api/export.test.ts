import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  canonicalMetrics,
  metrics as metricsTable,
  reports,
} from "@/db/schema";
import {
  computeExportCounts,
  getExportCandidates,
  type ExportCandidate,
} from "@/lib/export";

function canonicalByName(name: string) {
  const row = db
    .select({
      id: canonicalMetrics.id,
      category: canonicalMetrics.category,
      tags: canonicalMetrics.tags,
    })
    .from(canonicalMetrics)
    .where(eq(canonicalMetrics.canonicalName, name))
    .get();
  if (!row) throw new Error(`canonical "${name}" not seeded`);
  return row;
}

function seedReport(args: { provider: string; date: string; category?: string }): number {
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
  flag?: string | null;
}) {
  db.insert(metricsTable)
    .values({
      reportId: args.reportId,
      name: args.name,
      canonicalMetricId: args.canonicalMetricId,
      valueNumeric: args.value,
      flag: args.flag ?? null,
    })
    .run();
}

function clearAll() {
  db.delete(reports).run();
}

describe("getExportCandidates tags", () => {
  afterEach(() => {
    clearAll();
  });

  it("exposes canonical tags on each candidate so the /export chip filter can group by tag", () => {
    const c = canonicalByName("LDL Cholesterol");
    const rid = seedReport({ provider: "labcorp", date: "2025-06-01" });
    seedMetric({
      reportId: rid,
      name: "LDL-C",
      canonicalMetricId: c.id,
      value: 110,
    });

    const candidates = getExportCandidates("2025-01-01", "2025-12-31");
    const match = candidates.find((x) => x.id === c.id);
    expect(match).toBeDefined();
    expect(Array.isArray(match!.tags)).toBe(true);
    // Whatever the seed pins for this canonical, the candidate surfaces it.
    expect(match!.tags).toEqual(c.tags ?? []);
  });
});

describe("computeExportCounts", () => {
  it("tallies one unit per candidate per category and per tag", () => {
    const candidates: ExportCandidate[] = [
      {
        id: 1,
        canonicalName: "A",
        category: "lipids",
        categoryLabel: "Lipids",
        tags: ["cardio-risk", "longevity"],
        observationsInWindow: 3,
        flaggedInWindow: 1,
      },
      {
        id: 2,
        canonicalName: "B",
        category: "lipids",
        categoryLabel: "Lipids",
        tags: ["cardio-risk"],
        observationsInWindow: 1,
        flaggedInWindow: 0,
      },
      {
        id: 3,
        canonicalName: "C",
        category: "cbc",
        categoryLabel: "CBC",
        tags: [],
        observationsInWindow: 2,
        flaggedInWindow: 0,
      },
    ];

    const { categoryCounts, tagCounts } = computeExportCounts(candidates);
    expect(categoryCounts).toEqual({ lipids: 2, cbc: 1 });
    expect(tagCounts).toEqual({ "cardio-risk": 2, longevity: 1 });
  });

  it("returns empty objects when there are no candidates", () => {
    expect(computeExportCounts([])).toEqual({
      categoryCounts: {},
      tagCounts: {},
    });
  });
});
