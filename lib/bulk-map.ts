import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  canonicalMetrics,
  mappingProposals,
  mappingRuns,
  metricAliases,
  metrics as metricsTable,
  reports,
} from "@/db/schema";
import { normalizeRawName } from "@/lib/canonical-util";
import { CANONICAL_METRICS } from "@/db/seeds/canonical-metrics";
import { isCategorySlug, isTagSlug } from "@/db/seeds/taxonomy";
import {
  ClaudeBatch,
  SYSTEM_PROMPT,
  applyLossyFixes,
  applySelfHealSkips,
  buildClaudePrompt,
  chunk,
  parseClaudeResponse,
  recategorizeOther,
  sanitizeNewCanonical,
  type ExistingCanonicalForPrompt,
  type FixupProposal,
  type FixupCreateNew,
  type UnmappedRow,
} from "@/lib/bulk-map-util";

export const DEFAULT_MAPPING_MODEL =
  process.env.ANTHROPIC_MAPPING_MODEL ?? "claude-sonnet-4-6";
export const DEFAULT_MAPPING_BATCH_SIZE = 40;
export const DEFAULT_MAPPING_MAX_TOKENS = 16_000;
const STALE_PROPOSING_MINUTES = 15;

// ─── Data gathering ──────────────────────────────────────────────────────

export function gatherUnmapped(): UnmappedRow[] {
  const rows = db
    .select({
      name: metricsTable.name,
      provider: reports.provider,
      count: sql<number>`COUNT(*)`,
    })
    .from(metricsTable)
    .innerJoin(reports, eq(metricsTable.reportId, reports.id))
    .where(isNull(metricsTable.canonicalMetricId))
    .groupBy(metricsTable.name, reports.provider)
    .all();

  const byRaw = new Map<string, UnmappedRow>();
  for (const row of rows) {
    const key = normalizeRawName(row.name);
    if (!key) continue;
    const existing = byRaw.get(key);
    if (existing) {
      existing.occurrenceCount += Number(row.count);
      if (row.provider && !existing.sampleProviders.includes(row.provider)) {
        existing.sampleProviders.push(row.provider);
      }
    } else {
      byRaw.set(key, {
        rawName: row.name.trim(),
        occurrenceCount: Number(row.count),
        sampleProviders: row.provider ? [row.provider] : [],
      });
    }
  }
  return [...byRaw.values()].sort(
    (a, b) => b.occurrenceCount - a.occurrenceCount,
  );
}

export function loadExistingCanonicalsForPrompt(): ExistingCanonicalForPrompt[] {
  return db
    .select({
      canonicalName: canonicalMetrics.canonicalName,
      category: canonicalMetrics.category,
    })
    .from(canonicalMetrics)
    .all();
}

// ─── Claude call ─────────────────────────────────────────────────────────

export interface CallBatchOptions {
  model?: string;
  maxTokens?: number;
}

export async function callClaudeForBatch(
  client: Anthropic,
  existing: ExistingCanonicalForPrompt[],
  batch: UnmappedRow[],
  opts: CallBatchOptions = {},
): Promise<ClaudeBatch> {
  const userMsg = buildClaudePrompt(existing, batch);
  const resp = await client.messages.create({
    model: opts.model ?? DEFAULT_MAPPING_MODEL,
    max_tokens: opts.maxTokens ?? DEFAULT_MAPPING_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMsg }],
  });
  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return parseClaudeResponse(text);
}

// ─── Run creation + claim ────────────────────────────────────────────────

export interface CreateRunOptions {
  model?: string;
  batchSize?: number;
  limit?: number;
}

export interface CreateRunResult {
  runId: number;
  totalUnmapped: number;
  batchesTotal: number;
}

export function createMappingRun(
  opts: CreateRunOptions = {},
): CreateRunResult {
  const model = opts.model ?? DEFAULT_MAPPING_MODEL;
  const batchSize = opts.batchSize ?? DEFAULT_MAPPING_BATCH_SIZE;
  const limit = opts.limit ?? null;

  const unmapped = gatherUnmapped();
  const totalUnmapped = unmapped.length;
  const scoped = limit != null ? unmapped.slice(0, limit) : unmapped;
  const batchesTotal = Math.ceil(scoped.length / batchSize);

  const [row] = db
    .insert(mappingRuns)
    .values({
      status: "queued",
      model,
      batchSize,
      limitN: limit,
      totalUnmapped,
      batchesTotal,
    })
    .returning({ id: mappingRuns.id })
    .all();

  return { runId: row.id, totalUnmapped, batchesTotal };
}

interface ClaimedRun {
  id: number;
  model: string;
  batchSize: number;
  limitN: number | null;
}

// Atomically flip the next queued run to proposing. Only one run is ever
// active (concurrency 1), but the transactional claim still matters in case
// two process restarts race.
function claimNextRun(): ClaimedRun | null {
  return db.transaction((tx) => {
    const next = tx
      .select({
        id: mappingRuns.id,
        model: mappingRuns.model,
        batchSize: mappingRuns.batchSize,
        limitN: mappingRuns.limitN,
      })
      .from(mappingRuns)
      .where(eq(mappingRuns.status, "queued"))
      .orderBy(mappingRuns.id)
      .limit(1)
      .get();
    if (!next) return null;
    tx.update(mappingRuns)
      .set({
        status: "proposing",
        startedAt: sql`(CURRENT_TIMESTAMP)`,
        updatedAt: sql`(CURRENT_TIMESTAMP)`,
      })
      .where(
        and(eq(mappingRuns.id, next.id), eq(mappingRuns.status, "queued")),
      )
      .run();
    return next;
  });
}

function hasQueuedRun(): boolean {
  const r = db
    .select({ id: mappingRuns.id })
    .from(mappingRuns)
    .where(eq(mappingRuns.status, "queued"))
    .limit(1)
    .get();
  return !!r;
}

// ─── Proposal persistence ────────────────────────────────────────────────

interface PersistArgs {
  runId: number;
  batch: UnmappedRow[];
  result: ClaudeBatch;
  canonicalByName: Map<string, { id: number; canonicalName: string }>;
}

interface PersistOutcome {
  inserted: number;
  skipped: number;
  missing: UnmappedRow[];
}

// Convert a Claude batch result into mapping_proposals rows and upsert
// them. Missing names (Claude didn't return a proposal for them) are
// returned so the runner can log + track.
function persistProposalBatch(args: PersistArgs): PersistOutcome {
  const { runId, batch, result, canonicalByName } = args;

  const bySource = new Map<string, UnmappedRow>(
    batch.map((r) => [normalizeRawName(r.rawName), r]),
  );
  const seen = new Set<string>();
  let inserted = 0;
  let skipped = 0;

  db.transaction((tx) => {
    for (const p of result.proposals) {
      const key = normalizeRawName(p.rawName);
      const source = bySource.get(key);
      if (!source) {
        skipped += 1;
        continue;
      }
      seen.add(key);

      // Default shape — action-specific fields overridden below.
      let action: "map_existing" | "create_new" | "skip" = p.action;
      let canonicalMetricId: number | null = null;
      let proposedCanonicalName: string | null = null;
      let newCanonicalJson: string | null = null;
      let reason: string | null = p.reason ?? null;

      if (p.action === "map_existing") {
        const match = canonicalByName.get(p.canonicalName.toLowerCase());
        if (!match) {
          action = "skip";
          reason = `Claude proposed map_existing to "${p.canonicalName}" but no such canonical exists — needs human review`;
        } else {
          canonicalMetricId = match.id;
          proposedCanonicalName = match.canonicalName;
        }
      } else if (p.action === "create_new") {
        const sanitized = sanitizeNewCanonical(p.newCanonical);
        proposedCanonicalName = sanitized.canonicalName;
        newCanonicalJson = JSON.stringify({
          canonicalName: sanitized.canonicalName,
          category: sanitized.category,
          tags: sanitized.tags,
          preferredUnits: sanitized.preferredUnits,
          description: sanitized.description,
        });
        if (sanitized.originalCategory !== sanitized.category) {
          reason = [
            reason,
            `⚠ category "${sanitized.originalCategory}" coerced to "${sanitized.category}"`,
          ]
            .filter(Boolean)
            .join(" · ");
        }
        if (sanitized.droppedTags.length) {
          reason = [
            reason,
            `⚠ dropped unknown tag(s): ${sanitized.droppedTags.join(", ")}`,
          ]
            .filter(Boolean)
            .join(" · ");
        }
      }
      // skip action: canonicalMetricId/newCanonicalJson stay null; reason is set.

      tx.insert(mappingProposals)
        .values({
          runId,
          rawName: source.rawName,
          rawNameLower: key,
          occurrenceCount: source.occurrenceCount,
          sampleProvidersJson: JSON.stringify(source.sampleProviders),
          action,
          canonicalMetricId,
          proposedCanonicalName,
          newCanonicalJson,
          extraAliasesJson: "[]",
          confidence: p.confidence,
          reason,
          status: "pending",
        })
        .onConflictDoUpdate({
          target: [mappingProposals.runId, mappingProposals.rawNameLower],
          set: {
            action,
            canonicalMetricId,
            proposedCanonicalName,
            newCanonicalJson,
            confidence: p.confidence,
            reason,
            updatedAt: sql`(CURRENT_TIMESTAMP)`,
          },
        })
        .run();
      inserted += 1;
    }
  });

  const missing = batch.filter(
    (b) => !seen.has(normalizeRawName(b.rawName)),
  );
  return { inserted, skipped, missing };
}

function updateRunProgress(
  runId: number,
  updates: Partial<{
    batchesDone: number;
    proposedCount: number;
    failedBatchesJson: string;
    missingNamesJson: string;
  }>,
): void {
  db.update(mappingRuns)
    .set({ ...updates, updatedAt: sql`(CURRENT_TIMESTAMP)` })
    .where(eq(mappingRuns.id, runId))
    .run();
}

// ─── Runner ──────────────────────────────────────────────────────────────

let running = 0;
let pending = false;

export function kickMappingRunner(client?: Anthropic): void {
  if (running >= 1) {
    pending = true;
    return;
  }
  void runLoop(client);
}

// Synchronously drain every queued mapping run — used by the CLI so the
// process blocks until all runs finish, and by tests. kickMappingRunner is
// the fire-and-forget variant for route handlers.
export async function drainMappingRuns(client?: Anthropic): Promise<void> {
  await runLoop(client);
}

async function runLoop(client?: Anthropic): Promise<void> {
  pending = false;
  while (running < 1) {
    const claimed = claimNextRun();
    if (!claimed) break;
    running += 1;
    try {
      await processRun(claimed, client ?? new Anthropic());
    } finally {
      running -= 1;
      if (running < 1 && (pending || hasQueuedRun())) {
        void runLoop(client);
      }
    }
  }
}

interface FailedBatchRecord {
  batchIdx: number;
  error: string;
  names: string[];
}

async function processRun(
  run: ClaimedRun,
  client: Anthropic,
): Promise<void> {
  const existing = loadExistingCanonicalsForPrompt();
  const canonicalRows = db
    .select({
      id: canonicalMetrics.id,
      canonicalName: canonicalMetrics.canonicalName,
    })
    .from(canonicalMetrics)
    .all();
  const canonicalByName = new Map(
    canonicalRows.map((c) => [c.canonicalName.toLowerCase(), c]),
  );

  let unmapped = gatherUnmapped();
  if (run.limitN != null) unmapped = unmapped.slice(0, run.limitN);

  const batches = chunk(unmapped, run.batchSize);
  const failedBatches: FailedBatchRecord[] = [];
  const missingByBatch: UnmappedRow[] = [];
  let proposedCount = 0;

  for (let i = 0; i < batches.length; i += 1) {
    // Check if the run was canceled between batches.
    const current = db
      .select({ status: mappingRuns.status })
      .from(mappingRuns)
      .where(eq(mappingRuns.id, run.id))
      .get();
    if (!current || current.status !== "proposing") return;

    const batch = batches[i];
    try {
      const result = await callClaudeForBatch(client, existing, batch, {
        model: run.model,
      });
      const outcome = persistProposalBatch({
        runId: run.id,
        batch,
        result,
        canonicalByName,
      });
      proposedCount += outcome.inserted;
      missingByBatch.push(...outcome.missing);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failedBatches.push({
        batchIdx: i + 1,
        error: msg,
        names: batch.map((r) => r.rawName),
      });
      console.warn(
        `[bulk-map] run ${run.id} batch ${i + 1} failed: ${msg.slice(0, 200)}`,
      );
    }

    updateRunProgress(run.id, {
      batchesDone: i + 1,
      proposedCount,
      failedBatchesJson: JSON.stringify(failedBatches),
      missingNamesJson: JSON.stringify(missingByBatch.map((m) => m.rawName)),
    });
  }

  db.update(mappingRuns)
    .set({
      status: "ready_for_review",
      finishedAt: sql`(CURRENT_TIMESTAMP)`,
      updatedAt: sql`(CURRENT_TIMESTAMP)`,
    })
    .where(eq(mappingRuns.id, run.id))
    .run();
}

// Reset runs stuck in "proposing" past the staleness window back to
// "queued". Called on app boot alongside upload batch recovery.
export function recoverStuckMappingRuns(): number {
  const res = db
    .update(mappingRuns)
    .set({ status: "queued", updatedAt: sql`(CURRENT_TIMESTAMP)` })
    .where(
      and(
        eq(mappingRuns.status, "proposing"),
        sql`${mappingRuns.updatedAt} < datetime('now', ${`-${STALE_PROPOSING_MINUTES} minutes`})`,
      ),
    )
    .run();
  return res.changes ?? 0;
}

export function cancelRun(runId: number): boolean {
  const res = db
    .update(mappingRuns)
    .set({
      status: "canceled",
      finishedAt: sql`(CURRENT_TIMESTAMP)`,
      updatedAt: sql`(CURRENT_TIMESTAMP)`,
    })
    .where(
      and(
        eq(mappingRuns.id, runId),
        inArray(mappingRuns.status, ["queued", "proposing"]),
      ),
    )
    .run();
  return (res.changes ?? 0) > 0;
}

// ─── Run + proposal views ────────────────────────────────────────────────

export interface MappingRunView {
  id: number;
  status: string;
  model: string;
  batchSize: number;
  limit: number | null;
  totalUnmapped: number;
  batchesTotal: number;
  batchesDone: number;
  proposedCount: number;
  failedBatches: FailedBatchRecord[];
  missingNames: string[];
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  appliedAt: string | null;
  actionCounts: Record<string, number>;
  statusCounts: Record<string, number>;
}

export function getRun(runId: number): MappingRunView | null {
  const row = db
    .select()
    .from(mappingRuns)
    .where(eq(mappingRuns.id, runId))
    .get();
  if (!row) return null;

  const actionRows = db
    .select({
      action: mappingProposals.action,
      count: sql<number>`COUNT(*)`,
    })
    .from(mappingProposals)
    .where(eq(mappingProposals.runId, runId))
    .groupBy(mappingProposals.action)
    .all();
  const actionCounts: Record<string, number> = {};
  for (const r of actionRows) actionCounts[r.action] = Number(r.count);

  const statusRows = db
    .select({
      status: mappingProposals.status,
      count: sql<number>`COUNT(*)`,
    })
    .from(mappingProposals)
    .where(eq(mappingProposals.runId, runId))
    .groupBy(mappingProposals.status)
    .all();
  const statusCounts: Record<string, number> = {};
  for (const r of statusRows) statusCounts[r.status] = Number(r.count);

  return {
    id: row.id,
    status: row.status,
    model: row.model,
    batchSize: row.batchSize,
    limit: row.limitN,
    totalUnmapped: row.totalUnmapped,
    batchesTotal: row.batchesTotal,
    batchesDone: row.batchesDone,
    proposedCount: row.proposedCount,
    failedBatches: safeParseArray<FailedBatchRecord>(row.failedBatchesJson),
    missingNames: safeParseArray<string>(row.missingNamesJson),
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    appliedAt: row.appliedAt,
    actionCounts,
    statusCounts,
  };
}

export interface MappingProposalView {
  id: number;
  runId: number;
  rawName: string;
  rawNameLower: string;
  occurrenceCount: number;
  sampleProviders: string[];
  action: "map_existing" | "create_new" | "skip";
  canonicalMetricId: number | null;
  proposedCanonicalName: string | null;
  newCanonical: FixupCreateNew | null;
  extraAliases: string[];
  confidence: number;
  reason: string | null;
  status:
    | "pending"
    | "approved"
    | "rejected"
    | "applied"
    | "apply_error";
  editedByUser: boolean;
  applyError: string | null;
}

function rowToProposalView(
  row: typeof mappingProposals.$inferSelect,
): MappingProposalView {
  return {
    id: row.id,
    runId: row.runId,
    rawName: row.rawName,
    rawNameLower: row.rawNameLower,
    occurrenceCount: row.occurrenceCount,
    sampleProviders: safeParseArray<string>(row.sampleProvidersJson),
    action: row.action as MappingProposalView["action"],
    canonicalMetricId: row.canonicalMetricId,
    proposedCanonicalName: row.proposedCanonicalName,
    newCanonical: row.newCanonicalJson
      ? (JSON.parse(row.newCanonicalJson) as FixupCreateNew)
      : null,
    extraAliases: safeParseArray<string>(row.extraAliasesJson),
    confidence: row.confidence,
    reason: row.reason,
    status: row.status as MappingProposalView["status"],
    editedByUser: row.editedByUser === 1,
    applyError: row.applyError,
  };
}

export interface ListProposalsFilter {
  action?: "map_existing" | "create_new" | "skip";
  status?: MappingProposalView["status"];
  minConfidence?: number;
}

export function listProposals(
  runId: number,
  filter: ListProposalsFilter = {},
): MappingProposalView[] {
  const conditions = [eq(mappingProposals.runId, runId)];
  if (filter.action) conditions.push(eq(mappingProposals.action, filter.action));
  if (filter.status) conditions.push(eq(mappingProposals.status, filter.status));
  if (filter.minConfidence != null) {
    conditions.push(sql`${mappingProposals.confidence} >= ${filter.minConfidence}`);
  }
  const rows = db
    .select()
    .from(mappingProposals)
    .where(and(...conditions))
    .orderBy(sql`${mappingProposals.confidence} DESC`, mappingProposals.id)
    .all();
  return rows.map(rowToProposalView);
}

export function listRuns(limit = 20): MappingRunView[] {
  const rows = db
    .select({ id: mappingRuns.id })
    .from(mappingRuns)
    .orderBy(sql`${mappingRuns.id} DESC`)
    .limit(limit)
    .all();
  return rows
    .map((r) => getRun(r.id))
    .filter((r): r is MappingRunView => r !== null);
}

export function getLatestActiveRun(): MappingRunView | null {
  const row = db
    .select({ id: mappingRuns.id })
    .from(mappingRuns)
    .where(
      inArray(mappingRuns.status, ["queued", "proposing", "ready_for_review"]),
    )
    .orderBy(sql`${mappingRuns.id} DESC`)
    .limit(1)
    .get();
  if (!row) return null;
  return getRun(row.id);
}

// ─── Proposal edits ──────────────────────────────────────────────────────

const NewCanonicalEdit = z.object({
  canonicalName: z.string().min(1),
  category: z.string().refine(isCategorySlug),
  tags: z.array(z.string().refine(isTagSlug)),
  preferredUnits: z.string().nullable(),
  description: z.string(),
});

export const PatchProposalBody = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  canonicalMetricId: z.number().int().positive().optional(),
  newCanonical: NewCanonicalEdit.optional(),
  action: z.enum(["map_existing", "create_new", "skip"]).optional(),
  extraAliases: z.array(z.string()).optional(),
});
export type PatchProposalBody = z.infer<typeof PatchProposalBody>;

export function patchProposal(
  proposalId: number,
  body: PatchProposalBody,
): MappingProposalView | null {
  const existing = db
    .select()
    .from(mappingProposals)
    .where(eq(mappingProposals.id, proposalId))
    .get();
  if (!existing) return null;

  const updates: Partial<typeof mappingProposals.$inferInsert> = {
    updatedAt: sql`(CURRENT_TIMESTAMP)` as unknown as string,
  };
  let edited = false;

  if (body.action) updates.action = body.action;

  if (body.canonicalMetricId != null) {
    const canonical = db
      .select({
        id: canonicalMetrics.id,
        canonicalName: canonicalMetrics.canonicalName,
      })
      .from(canonicalMetrics)
      .where(eq(canonicalMetrics.id, body.canonicalMetricId))
      .get();
    if (!canonical) throw new Error(`canonicalMetricId ${body.canonicalMetricId} not found`);
    updates.canonicalMetricId = canonical.id;
    updates.proposedCanonicalName = canonical.canonicalName;
    updates.action = body.action ?? "map_existing";
    updates.newCanonicalJson = null;
    edited = true;
  }

  if (body.newCanonical) {
    updates.newCanonicalJson = JSON.stringify(body.newCanonical);
    updates.proposedCanonicalName = body.newCanonical.canonicalName;
    updates.canonicalMetricId = null;
    updates.action = body.action ?? "create_new";
    edited = true;
  }

  if (body.extraAliases) {
    updates.extraAliasesJson = JSON.stringify(body.extraAliases);
    edited = true;
  }

  if (body.status) {
    updates.status = body.status;
  } else if (edited) {
    // An edit is itself confirmation — auto-approve (plan decision #4).
    updates.status = "approved";
  }

  if (edited) updates.editedByUser = 1;

  db.update(mappingProposals)
    .set(updates)
    .where(eq(mappingProposals.id, proposalId))
    .run();

  const updated = db
    .select()
    .from(mappingProposals)
    .where(eq(mappingProposals.id, proposalId))
    .get();
  return updated ? rowToProposalView(updated) : null;
}

// ─── Fixup ───────────────────────────────────────────────────────────────

export interface FixupSummary {
  lossyFixed: number;
  selfHealed: number;
  recategorized: number;
  recatCounts: Record<string, number>;
}

// Apply the three deterministic fix passes against a run's proposals.
// Idempotent: running twice in a row produces the same result.
export function runFixupOnRun(runId: number): FixupSummary {
  const rows = db
    .select()
    .from(mappingProposals)
    .where(eq(mappingProposals.runId, runId))
    .all();

  interface Work extends FixupProposal {
    id: number;
    status: string;
  }
  const items: Work[] = rows.map((r) => ({
    id: r.id,
    status: r.status,
    rawName: r.rawName,
    action: r.action as FixupProposal["action"],
    proposedCanonicalName: r.proposedCanonicalName,
    newCanonical: r.newCanonicalJson
      ? (JSON.parse(r.newCanonicalJson) as FixupCreateNew)
      : null,
    extraAliases: safeParseArray<string>(r.extraAliasesJson),
    reason: r.reason,
  }));

  const lossy = applyLossyFixes(items);
  const healed = applySelfHealSkips(lossy.proposals);
  const recat = recategorizeOther(healed.proposals);

  // Rows that disappeared during self-heal need to be marked rejected
  // (not deleted — they carry audit value).
  const afterIds = new Set(recat.proposals.map((p) => p.id));
  const droppedByHeal = items.filter((i) => !afterIds.has(i.id));

  db.transaction((tx) => {
    for (const p of recat.proposals) {
      tx.update(mappingProposals)
        .set({
          action: p.action,
          proposedCanonicalName: p.proposedCanonicalName ?? null,
          newCanonicalJson: p.newCanonical
            ? JSON.stringify(p.newCanonical)
            : null,
          extraAliasesJson: JSON.stringify(p.extraAliases ?? []),
          reason: p.reason ?? null,
          updatedAt: sql`(CURRENT_TIMESTAMP)`,
        })
        .where(eq(mappingProposals.id, p.id))
        .run();
    }
    for (const p of droppedByHeal) {
      tx.update(mappingProposals)
        .set({
          status: "rejected",
          reason: [p.reason, "(folded into target's extraAliases via fixup)"]
            .filter(Boolean)
            .join(" · "),
          updatedAt: sql`(CURRENT_TIMESTAMP)`,
        })
        .where(eq(mappingProposals.id, p.id))
        .run();
    }
  });

  return {
    lossyFixed: lossy.fixed,
    selfHealed: healed.selfHealed,
    recategorized: recat.recategorized,
    recatCounts: recat.countsByCategory,
  };
}

// ─── Apply ───────────────────────────────────────────────────────────────

export interface ApplySummary {
  runId: number;
  canonicalsInserted: number;
  aliasesInserted: number;
  aliasesUpdated: number;
  metricsBackfilled: number;
  proposalsApplied: number;
  proposalsFailed: number;
  proposalsSkipped: number;
}

export interface ApplyOptions {
  includeUnreviewed?: boolean;
}

export class HasPendingProposalsError extends Error {
  constructor(public pendingCount: number) {
    super(
      `Run has ${pendingCount} pending proposals — either review them or pass includeUnreviewed=true`,
    );
    this.name = "HasPendingProposalsError";
  }
}

export function applyRun(
  runId: number,
  opts: ApplyOptions = {},
): ApplySummary {
  const run = db
    .select()
    .from(mappingRuns)
    .where(eq(mappingRuns.id, runId))
    .get();
  if (!run) throw new Error(`run ${runId} not found`);
  if (run.status !== "ready_for_review" && run.status !== "error") {
    throw new Error(
      `run ${runId} is in status "${run.status}" — can only apply from ready_for_review`,
    );
  }

  const pending = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(mappingProposals)
    .where(
      and(
        eq(mappingProposals.runId, runId),
        eq(mappingProposals.status, "pending"),
      ),
    )
    .get();
  const pendingCount = Number(pending?.count ?? 0);
  if (pendingCount > 0 && !opts.includeUnreviewed) {
    throw new HasPendingProposalsError(pendingCount);
  }

  db.update(mappingRuns)
    .set({ status: "applying", updatedAt: sql`(CURRENT_TIMESTAMP)` })
    .where(eq(mappingRuns.id, runId))
    .run();

  let canonicalsInserted = 0;
  let aliasesInserted = 0;
  let aliasesUpdated = 0;
  let metricsBackfilled = 0;
  let proposalsApplied = 0;
  let proposalsFailed = 0;
  let proposalsSkipped = 0;

  try {
    db.transaction((tx) => {
      const targetStatuses = opts.includeUnreviewed
        ? ["approved", "pending"]
        : ["approved"];
      const rows = tx
        .select()
        .from(mappingProposals)
        .where(
          and(
            eq(mappingProposals.runId, runId),
            inArray(mappingProposals.status, targetStatuses),
          ),
        )
        .all();

      for (const p of rows) {
        if (p.action === "skip") {
          tx.update(mappingProposals)
            .set({
              status: "rejected",
              updatedAt: sql`(CURRENT_TIMESTAMP)`,
            })
            .where(eq(mappingProposals.id, p.id))
            .run();
          proposalsSkipped += 1;
          continue;
        }

        try {
          let canonicalId: number;
          if (p.action === "map_existing") {
            if (p.canonicalMetricId == null) {
              throw new Error("map_existing proposal has no canonicalMetricId");
            }
            canonicalId = p.canonicalMetricId;
          } else {
            // create_new
            if (!p.newCanonicalJson) {
              throw new Error("create_new proposal has no newCanonicalJson");
            }
            const nc = JSON.parse(p.newCanonicalJson) as FixupCreateNew;
            const existing = tx
              .select({ id: canonicalMetrics.id })
              .from(canonicalMetrics)
              .where(eq(canonicalMetrics.canonicalName, nc.canonicalName))
              .get();
            if (existing) {
              canonicalId = existing.id;
            } else {
              const [row] = tx
                .insert(canonicalMetrics)
                .values({
                  canonicalName: nc.canonicalName,
                  category: nc.category,
                  tags: nc.tags,
                  preferredUnits: nc.preferredUnits,
                  description: nc.description,
                })
                .returning({ id: canonicalMetrics.id })
                .all();
              canonicalId = row.id;
              canonicalsInserted += 1;
            }
          }

          // Upsert global alias (provider = ""). Matches POST /api/mappings.
          const upsertStats = upsertAliasAndBackfill(
            tx,
            p.rawNameLower,
            canonicalId,
          );
          aliasesInserted += upsertStats.aliasInserted ? 1 : 0;
          aliasesUpdated += upsertStats.aliasUpdated ? 1 : 0;
          metricsBackfilled += upsertStats.metricsUpdated;

          const extras = safeParseArray<string>(p.extraAliasesJson);
          for (const extra of extras) {
            const extraKey = normalizeRawName(extra);
            if (!extraKey || extraKey === p.rawNameLower) continue;
            const extraStats = upsertAliasAndBackfill(
              tx,
              extraKey,
              canonicalId,
            );
            aliasesInserted += extraStats.aliasInserted ? 1 : 0;
            aliasesUpdated += extraStats.aliasUpdated ? 1 : 0;
            metricsBackfilled += extraStats.metricsUpdated;
          }

          tx.update(mappingProposals)
            .set({
              status: "applied",
              canonicalMetricId: canonicalId,
              applyError: null,
              updatedAt: sql`(CURRENT_TIMESTAMP)`,
            })
            .where(eq(mappingProposals.id, p.id))
            .run();
          proposalsApplied += 1;
        } catch (err) {
          // Partial failure is a bug — surface it and abort (plan decision #2).
          proposalsFailed += 1;
          tx.update(mappingProposals)
            .set({
              status: "apply_error",
              applyError: (err as Error).message.slice(0, 4000),
              updatedAt: sql`(CURRENT_TIMESTAMP)`,
            })
            .where(eq(mappingProposals.id, p.id))
            .run();
          throw err;
        }
      }
    });

    db.update(mappingRuns)
      .set({
        status: "applied",
        appliedAt: sql`(CURRENT_TIMESTAMP)`,
        updatedAt: sql`(CURRENT_TIMESTAMP)`,
      })
      .where(eq(mappingRuns.id, runId))
      .run();
  } catch (err) {
    db.update(mappingRuns)
      .set({
        status: "error",
        errorMessage: (err as Error).message.slice(0, 4000),
        updatedAt: sql`(CURRENT_TIMESTAMP)`,
      })
      .where(eq(mappingRuns.id, runId))
      .run();
    throw err;
  }

  return {
    runId,
    canonicalsInserted,
    aliasesInserted,
    aliasesUpdated,
    metricsBackfilled,
    proposalsApplied,
    proposalsFailed,
    proposalsSkipped,
  };
}

interface UpsertStats {
  aliasInserted: boolean;
  aliasUpdated: boolean;
  metricsUpdated: number;
}

function upsertAliasAndBackfill(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  rawKey: string,
  canonicalId: number,
): UpsertStats {
  const existing = tx
    .select({ canonicalMetricId: metricAliases.canonicalMetricId })
    .from(metricAliases)
    .where(
      and(
        eq(metricAliases.rawNameLower, rawKey),
        eq(metricAliases.provider, ""),
      ),
    )
    .get();

  let aliasInserted = false;
  let aliasUpdated = false;
  if (existing) {
    if (existing.canonicalMetricId !== canonicalId) {
      tx.update(metricAliases)
        .set({ canonicalMetricId: canonicalId })
        .where(
          and(
            eq(metricAliases.rawNameLower, rawKey),
            eq(metricAliases.provider, ""),
          ),
        )
        .run();
      aliasUpdated = true;
    }
  } else {
    tx.insert(metricAliases)
      .values({ rawNameLower: rawKey, provider: "", canonicalMetricId: canonicalId })
      .run();
    aliasInserted = true;
  }

  const res = tx
    .update(metricsTable)
    .set({ canonicalMetricId: canonicalId })
    .where(
      and(
        isNull(metricsTable.canonicalMetricId),
        sql`LOWER(TRIM(${metricsTable.name})) = ${rawKey}`,
      ),
    )
    .run();

  return {
    aliasInserted,
    aliasUpdated,
    metricsUpdated: res.changes ?? 0,
  };
}

// ─── Seed diff ───────────────────────────────────────────────────────────

export interface SeedDiff {
  newCanonicals: {
    canonicalName: string;
    category: string;
    tags: string[];
    preferredUnits: string | null;
    description: string;
    aliases: string[];
  }[];
  aliasAdditions: { canonicalName: string; newAliases: string[] }[];
  formatted: string;
}

export function computeSeedDiff(): SeedDiff {
  const dbCanonicals = db
    .select({
      id: canonicalMetrics.id,
      canonicalName: canonicalMetrics.canonicalName,
      category: canonicalMetrics.category,
      tags: canonicalMetrics.tags,
      preferredUnits: canonicalMetrics.preferredUnits,
      description: canonicalMetrics.description,
    })
    .from(canonicalMetrics)
    .all();

  const dbGlobalAliases = db
    .select({
      rawNameLower: metricAliases.rawNameLower,
      canonicalMetricId: metricAliases.canonicalMetricId,
    })
    .from(metricAliases)
    .where(eq(metricAliases.provider, ""))
    .all();

  const aliasesByCanonicalId = new Map<number, string[]>();
  for (const a of dbGlobalAliases) {
    const arr = aliasesByCanonicalId.get(a.canonicalMetricId) ?? [];
    arr.push(a.rawNameLower);
    aliasesByCanonicalId.set(a.canonicalMetricId, arr);
  }

  const seedByName = new Map(
    CANONICAL_METRICS.map((s) => [s.canonicalName, s]),
  );

  const newCanonicals: SeedDiff["newCanonicals"] = [];
  const aliasAdditions: SeedDiff["aliasAdditions"] = [];

  for (const c of dbCanonicals) {
    const seed = seedByName.get(c.canonicalName);
    const dbAliases = (aliasesByCanonicalId.get(c.id) ?? []).slice().sort();
    if (!seed) {
      newCanonicals.push({
        canonicalName: c.canonicalName,
        category: c.category,
        tags: Array.isArray(c.tags) ? c.tags : [],
        preferredUnits: c.preferredUnits,
        description: c.description ?? "",
        aliases: dbAliases,
      });
      continue;
    }
    const seededSet = new Set(
      seed.aliases.map((a) => normalizeRawName(a)).filter(Boolean),
    );
    const newAliases = dbAliases.filter((a) => !seededSet.has(a));
    if (newAliases.length) {
      aliasAdditions.push({ canonicalName: c.canonicalName, newAliases });
    }
  }

  newCanonicals.sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));
  aliasAdditions.sort((a, b) =>
    a.canonicalName.localeCompare(b.canonicalName),
  );

  const lines: string[] = [];
  lines.push(`// Exported by \`pnpm bulk-map --export-seed\` on ${new Date().toISOString()}`);
  lines.push(`// Paste the block(s) below into db/seeds/canonical-metrics.ts.`);
  lines.push("");

  if (newCanonicals.length) {
    lines.push(`// ── New canonicals (append inside CANONICAL_METRICS array) ──`);
    for (const c of newCanonicals) {
      lines.push(`  {`);
      lines.push(`    canonicalName: ${JSON.stringify(c.canonicalName)},`);
      lines.push(`    category: ${JSON.stringify(c.category)},`);
      lines.push(`    tags: [${c.tags.map((t) => JSON.stringify(t)).join(", ")}],`);
      lines.push(
        `    preferredUnits: ${c.preferredUnits === null ? "null" : JSON.stringify(c.preferredUnits)},`,
      );
      lines.push(`    description: ${JSON.stringify(c.description)},`);
      lines.push(`    aliases: [`);
      for (const a of c.aliases) lines.push(`      ${JSON.stringify(a)},`);
      lines.push(`    ],`);
      lines.push(`  },`);
    }
    lines.push("");
  }

  if (aliasAdditions.length) {
    lines.push(`// ── New aliases on existing canonicals ──`);
    lines.push(`// For each entry, add the listed aliases to the existing`);
    lines.push(`// canonical's aliases array in canonical-metrics.ts.`);
    for (const a of aliasAdditions) {
      lines.push(`//   ${a.canonicalName}:`);
      for (const alias of a.newAliases) lines.push(`//     + ${alias}`);
    }
    lines.push("");
  }

  if (!newCanonicals.length && !aliasAdditions.length) {
    lines.push(`// No new canonicals or aliases to export. Seed is in sync with DB.`);
  }

  return {
    newCanonicals,
    aliasAdditions,
    formatted: lines.join("\n") + "\n",
  };
}

// ─── utils ───────────────────────────────────────────────────────────────

function safeParseArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}
