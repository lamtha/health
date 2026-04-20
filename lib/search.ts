import "server-only";

import { desc, like, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  canonicalMetrics as canonicalMetricsTable,
  metricAliases,
  metrics as metricsTable,
  reports,
} from "@/db/schema";

export interface SearchMetricHit {
  canonicalMetricId: number;
  canonicalName: string;
  category: string;
  aliasCount: number;
  matchedAlias: string | null;
}

export interface SearchReportHit {
  id: number;
  reportDate: string | null;
  provider: string;
  category: string;
}

export interface SearchUnmappedHit {
  rawName: string;
  occurrenceCount: number;
}

export interface SearchResult {
  query: string;
  metrics: SearchMetricHit[];
  unmapped: SearchUnmappedHit[];
  reports: SearchReportHit[];
}

const METRIC_LIMIT = 8;
const REPORT_LIMIT = 8;
const UNMAPPED_LIMIT = 6;

export function searchAll(rawQuery: string): SearchResult {
  const q = rawQuery.trim();
  if (!q) {
    return { query: "", metrics: [], unmapped: [], reports: [] };
  }

  const needle = `%${q.toLowerCase()}%`;

  // Canonicals where the canonical name matches OR any alias matches.
  const matchedAliasRows = db
    .select({
      canonicalMetricId: metricAliases.canonicalMetricId,
      rawNameLower: metricAliases.rawNameLower,
    })
    .from(metricAliases)
    .where(like(metricAliases.rawNameLower, needle))
    .all();

  const aliasHitByCanonical = new Map<number, string>();
  for (const a of matchedAliasRows) {
    if (!aliasHitByCanonical.has(a.canonicalMetricId)) {
      aliasHitByCanonical.set(a.canonicalMetricId, a.rawNameLower);
    }
  }

  const canonicalNameHits = db
    .select({
      id: canonicalMetricsTable.id,
      canonicalName: canonicalMetricsTable.canonicalName,
      category: canonicalMetricsTable.category,
    })
    .from(canonicalMetricsTable)
    .where(sql`LOWER(${canonicalMetricsTable.canonicalName}) LIKE ${needle}`)
    .all();

  const canonicalById = new Map<
    number,
    { canonicalName: string; category: string }
  >();
  for (const c of canonicalNameHits) {
    canonicalById.set(c.id, { canonicalName: c.canonicalName, category: c.category });
  }
  const missingCanonicalIds = [...aliasHitByCanonical.keys()].filter(
    (id) => !canonicalById.has(id),
  );
  if (missingCanonicalIds.length > 0) {
    const extra = db
      .select({
        id: canonicalMetricsTable.id,
        canonicalName: canonicalMetricsTable.canonicalName,
        category: canonicalMetricsTable.category,
      })
      .from(canonicalMetricsTable)
      .where(
        sql`${canonicalMetricsTable.id} IN (${sql.join(
          missingCanonicalIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      )
      .all();
    for (const c of extra) {
      canonicalById.set(c.id, {
        canonicalName: c.canonicalName,
        category: c.category,
      });
    }
  }

  const aliasCounts = db
    .select({
      canonicalMetricId: metricAliases.canonicalMetricId,
      count: sql<number>`count(*)`,
    })
    .from(metricAliases)
    .groupBy(metricAliases.canonicalMetricId)
    .all();
  const aliasCountById = new Map<number, number>();
  for (const a of aliasCounts) {
    aliasCountById.set(a.canonicalMetricId, a.count);
  }

  const metrics: SearchMetricHit[] = [];
  for (const [id, entry] of canonicalById) {
    metrics.push({
      canonicalMetricId: id,
      canonicalName: entry.canonicalName,
      category: entry.category,
      aliasCount: aliasCountById.get(id) ?? 0,
      matchedAlias: aliasHitByCanonical.get(id) ?? null,
    });
  }
  metrics.sort((a, b) => {
    // Canonical-name matches (no alias-only hit) first; within a group,
    // alpha on canonical name.
    const aAliasOnly = a.matchedAlias != null && !a.canonicalName.toLowerCase().includes(q.toLowerCase());
    const bAliasOnly = b.matchedAlias != null && !b.canonicalName.toLowerCase().includes(q.toLowerCase());
    if (aAliasOnly !== bAliasOnly) return aAliasOnly ? 1 : -1;
    return a.canonicalName.localeCompare(b.canonicalName);
  });

  const unmappedRows = db
    .select({
      name: metricsTable.name,
      count: sql<number>`count(*)`,
    })
    .from(metricsTable)
    .where(
      sql`${metricsTable.canonicalMetricId} IS NULL AND LOWER(${metricsTable.name}) LIKE ${needle}`,
    )
    .groupBy(sql`LOWER(TRIM(${metricsTable.name}))`)
    .orderBy(sql`count(*) DESC`)
    .limit(UNMAPPED_LIMIT)
    .all();

  const unmapped: SearchUnmappedHit[] = unmappedRows.map((r) => ({
    rawName: r.name,
    occurrenceCount: r.count,
  }));

  const reportRows = db
    .select({
      id: reports.id,
      reportDate: reports.reportDate,
      provider: reports.provider,
      category: reports.category,
    })
    .from(reports)
    .where(
      or(
        sql`LOWER(${reports.provider}) LIKE ${needle}`,
        sql`${reports.reportDate} LIKE ${needle}`,
      ),
    )
    .orderBy(desc(reports.reportDate), desc(reports.uploadedAt))
    .limit(REPORT_LIMIT)
    .all();

  return {
    query: q,
    metrics: metrics.slice(0, METRIC_LIMIT),
    unmapped,
    reports: reportRows,
  };
}

