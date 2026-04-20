import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { normalizeProvider, normalizeRawName } from "@/lib/canonical-util";
import {
  canonicalMetrics,
  metricAliases,
  metrics as metricsTable,
} from "@/db/schema";
import { isCategorySlug, isTagSlug } from "@/db/seeds/taxonomy";

const Body = z.object({
  rawName: z.string().min(1),
  providerScope: z.string().optional().nullable(),
  canonicalMetricId: z.number().int().positive().optional(),
  newCanonical: z
    .object({
      canonicalName: z.string().min(1),
      category: z.string().refine(isCategorySlug, {
        message: "unknown category slug",
      }),
      tags: z.array(z.string().refine(isTagSlug, {
        message: "unknown tag slug",
      })),
      preferredUnits: z.string().nullable().optional(),
      description: z.string().optional(),
    })
    .optional(),
});

export async function POST(req: Request) {
  const json = await req.json();
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;

  if (!input.canonicalMetricId && !input.newCanonical) {
    return NextResponse.json(
      { error: "provide canonicalMetricId or newCanonical" },
      { status: 400 },
    );
  }

  const rawKey = normalizeRawName(input.rawName);
  if (!rawKey) {
    return NextResponse.json(
      { error: "rawName normalizes to empty" },
      { status: 400 },
    );
  }
  const providerKey = normalizeProvider(input.providerScope);

  const result = db.transaction((tx) => {
    let canonicalId = input.canonicalMetricId ?? null;

    if (!canonicalId && input.newCanonical) {
      const existing = tx
        .select({ id: canonicalMetrics.id })
        .from(canonicalMetrics)
        .where(eq(canonicalMetrics.canonicalName, input.newCanonical.canonicalName))
        .get();
      if (existing) {
        canonicalId = existing.id;
      } else {
        const [row] = tx
          .insert(canonicalMetrics)
          .values({
            canonicalName: input.newCanonical.canonicalName,
            category: input.newCanonical.category,
            tags: input.newCanonical.tags,
            preferredUnits: input.newCanonical.preferredUnits ?? null,
            description: input.newCanonical.description ?? "",
          })
          .returning({ id: canonicalMetrics.id })
          .all();
        canonicalId = row.id;
      }
    }

    if (!canonicalId) {
      throw new Error("canonicalId resolution failed");
    }

    tx
      .insert(metricAliases)
      .values({
        rawNameLower: rawKey,
        provider: providerKey,
        canonicalMetricId: canonicalId,
      })
      .onConflictDoUpdate({
        target: [metricAliases.rawNameLower, metricAliases.provider],
        set: { canonicalMetricId: canonicalId },
      })
      .run();

    // Backfill. If providerScope is non-empty, limit to metrics under that
    // provider; global aliases backfill across all providers.
    const backfillWhere = providerKey
      ? and(
          sql`LOWER(TRIM(${metricsTable.name})) = ${rawKey}`,
          sql`${metricsTable.reportId} IN (SELECT id FROM reports WHERE LOWER(provider) = ${providerKey})`,
        )
      : sql`LOWER(TRIM(${metricsTable.name})) = ${rawKey}`;

    const updated = tx
      .update(metricsTable)
      .set({ canonicalMetricId: canonicalId })
      .where(backfillWhere)
      .run();

    return {
      canonicalMetricId: canonicalId,
      backfilledRows: updated.changes ?? 0,
    };
  });

  return NextResponse.json({ ok: true, ...result });
}
