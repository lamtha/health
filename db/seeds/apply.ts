import { and, eq, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import { canonicalMetrics, metricAliases } from "@/db/schema";
import { CANONICAL_METRICS } from "@/db/seeds/canonical-metrics";
import { normalizeRawName } from "@/lib/canonical-util";

export interface SeedReport {
  canonicalInserted: number;
  canonicalUpdated: number;
  aliasInserted: number;
  aliasSkipped: number;
}

// Idempotent seed apply. Safe to run on every boot of the packaged app
// (`lib/db.ts` calls this after `migrate()`), and also via `pnpm db:seed`.
//
// - Upserts canonical_metrics by canonical_name.
// - Inserts metric_aliases rows (global scope: provider = "") for each
//   alias that doesn't already exist.
// - NEVER deletes or reassigns existing aliases — user-created mappings
//   from /mappings always win.
//
// The cast in the function signature keeps callers out of the
// generic-schema weeds; internally we only touch the two tables we own.
export function applySeeds(
  db: BetterSQLite3Database<Record<string, unknown>>,
): SeedReport {
  const report: SeedReport = {
    canonicalInserted: 0,
    canonicalUpdated: 0,
    aliasInserted: 0,
    aliasSkipped: 0,
  };

  db.transaction((tx) => {
    for (const seed of CANONICAL_METRICS) {
      const existing = tx
        .select({ id: canonicalMetrics.id })
        .from(canonicalMetrics)
        .where(eq(canonicalMetrics.canonicalName, seed.canonicalName))
        .get();

      let canonicalId: number;
      if (!existing) {
        const [row] = tx
          .insert(canonicalMetrics)
          .values({
            canonicalName: seed.canonicalName,
            category: seed.category,
            tags: seed.tags,
            preferredUnits: seed.preferredUnits,
            description: seed.description,
          })
          .returning({ id: canonicalMetrics.id })
          .all();
        canonicalId = row.id;
        report.canonicalInserted += 1;
      } else {
        canonicalId = existing.id;
        tx
          .update(canonicalMetrics)
          .set({
            category: seed.category,
            tags: seed.tags,
            preferredUnits: seed.preferredUnits,
            description: seed.description,
          })
          .where(eq(canonicalMetrics.id, canonicalId))
          .run();
        report.canonicalUpdated += 1;
      }

      for (const rawAlias of seed.aliases) {
        const rawNameLower = normalizeRawName(rawAlias);
        if (!rawNameLower) continue;

        const existingAlias = tx
          .select({ id: metricAliases.canonicalMetricId })
          .from(metricAliases)
          .where(
            and(
              eq(metricAliases.rawNameLower, rawNameLower),
              eq(metricAliases.provider, ""),
            ),
          )
          .get();

        if (existingAlias) {
          report.aliasSkipped += 1;
          continue;
        }

        tx
          .insert(metricAliases)
          .values({
            rawNameLower,
            provider: "",
            canonicalMetricId: canonicalId,
          })
          .onConflictDoNothing()
          .run();
        report.aliasInserted += 1;
      }
    }
  });

  return report;
}

// Standalone count helpers for scripts.
export function canonicalCount(
  db: BetterSQLite3Database<Record<string, unknown>>,
): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(canonicalMetrics)
    .get();
  return row?.n ?? 0;
}

export function aliasCount(
  db: BetterSQLite3Database<Record<string, unknown>>,
): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(metricAliases)
    .get();
  return row?.n ?? 0;
}
