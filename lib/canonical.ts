import "server-only";

import { and, eq, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { metricAliases } from "@/db/schema";
import { normalizeProvider, normalizeRawName } from "@/lib/canonical-util";

export { normalizeRawName, normalizeProvider } from "@/lib/canonical-util";

// Resolve a raw metric name to a canonical metric id via the
// metric_aliases table. Two-pass match:
//   1. exact (rawNameLower, provider) — lets us disambiguate when the
//      same raw name means different things across labs.
//   2. global (rawNameLower, provider = "") fallback.
// Returns null when unmapped; caller leaves canonical_metric_id null and
// the row surfaces at /mappings.
export function resolveCanonicalId(
  rawName: string,
  provider?: string | null,
): number | null {
  const key = normalizeRawName(rawName);
  if (!key) return null;

  const providerScope = normalizeProvider(provider);

  // Single query that prefers provider-scoped match over global. If the
  // provider is empty, both branches of the OR collapse to the same row.
  const rows = db
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

  if (rows.length === 0) return null;

  const scoped = rows.find((r) => r.provider === providerScope && providerScope !== "");
  if (scoped) return scoped.canonicalMetricId;
  const global = rows.find((r) => r.provider === "");
  return global?.canonicalMetricId ?? rows[0].canonicalMetricId;
}
