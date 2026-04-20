import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { and, eq, isNull, or, sql } from "drizzle-orm";

import * as schema from "@/db/schema";
import {
  metricAliases,
  metrics as metricsTable,
  reports,
} from "@/db/schema";
import { dbPath } from "@/lib/paths";
import { normalizeRawName, normalizeProvider } from "@/lib/canonical-util";

// One-shot: for every metric with canonical_metric_id IS NULL, look up
// (raw_name_lower, provider) → (raw_name_lower, "") in metric_aliases
// and set canonical_metric_id when matched. Idempotent: rows that still
// don't match stay null and queue up at /mappings.

const file = dbPath();
fs.mkdirSync(path.dirname(file), { recursive: true });
const sqlite = new Database(file);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });

// Pull every unmapped metric row joined with its report provider.
const unmapped = db
  .select({
    metricId: metricsTable.id,
    name: metricsTable.name,
    provider: reports.provider,
  })
  .from(metricsTable)
  .innerJoin(reports, eq(metricsTable.reportId, reports.id))
  .where(isNull(metricsTable.canonicalMetricId))
  .all();

const updateStmt = sqlite.prepare(
  "UPDATE metrics SET canonical_metric_id = ? WHERE id = ?",
);

let matched = 0;
let stillUnmapped = 0;

const applyAll = sqlite.transaction(
  (rows: typeof unmapped) => {
    for (const row of rows) {
      const key = normalizeRawName(row.name);
      if (!key) {
        stillUnmapped += 1;
        continue;
      }
      const providerScope = normalizeProvider(row.provider);

      const match = db
        .select({
          canonicalMetricId: metricAliases.canonicalMetricId,
          provider: metricAliases.provider,
        })
        .from(metricAliases)
        .where(
          and(
            eq(metricAliases.rawNameLower, key),
            or(
              eq(metricAliases.provider, providerScope),
              eq(metricAliases.provider, ""),
            ),
          ),
        )
        .all();

      const scoped = match.find(
        (m) => m.provider === providerScope && providerScope !== "",
      );
      const global = match.find((m) => m.provider === "");
      const canonicalId =
        scoped?.canonicalMetricId ??
        global?.canonicalMetricId ??
        null;

      if (canonicalId != null) {
        updateStmt.run(canonicalId, row.metricId);
        matched += 1;
      } else {
        stillUnmapped += 1;
      }
    }
  },
);

applyAll(unmapped);

const totalRow = db
  .select({
    n: sql<number>`count(*)`,
  })
  .from(metricsTable)
  .get();
const stillNullRow = db
  .select({
    n: sql<number>`count(*)`,
  })
  .from(metricsTable)
  .where(isNull(metricsTable.canonicalMetricId))
  .get();

console.log(
  [
    `Backfill canonical_metric_id → ${file}`,
    `  metrics examined:    ${unmapped.length}`,
    `  newly linked:        ${matched}`,
    `  still unmapped:      ${stillUnmapped}`,
    `  --`,
    `  metrics total:       ${totalRow?.n ?? 0}`,
    `  canonical-null total: ${stillNullRow?.n ?? 0}`,
  ].join("\n"),
);

sqlite.close();
