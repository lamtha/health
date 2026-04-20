import "server-only";

import path from "node:path";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { extractReportFromPdf } from "@/lib/extract";
import { findReportByHash, insertExtractedReport } from "@/lib/ingest";
import { stagingDir } from "@/lib/paths";
import { discardStaged, promoteStaged } from "@/lib/staging";
import { uploadBatches, uploadBatchItems } from "@/db/schema";

const CONCURRENCY = 3;
const STAGING_PDF = "source.pdf";

let running = 0;
let pending = false;

// Items whose updatedAt is older than this are considered genuinely stuck
// (process died before the row could be finalized). Active workers touch
// updatedAt when they claim an item, so this won't stomp on in-flight work.
const STALE_EXTRACTING_MINUTES = 15;

// Kick the worker loop. Safe to call repeatedly — workers only spawn up to
// CONCURRENCY, and the loop drains whatever is queued in SQLite regardless
// of how many callers prodded it.
export function kickBatchRunner(): void {
  if (running >= CONCURRENCY) {
    pending = true;
    return;
  }
  void runLoop();
}

async function runLoop(): Promise<void> {
  pending = false;
  while (running < CONCURRENCY) {
    const item = claimNext();
    if (!item) break;
    running += 1;
    void processItem(item).finally(() => {
      running -= 1;
      if (running < CONCURRENCY && (pending || hasQueued())) {
        void runLoop();
      }
    });
  }
}

interface ClaimedItem {
  id: number;
  batchId: number;
  stagingId: string;
  fileHash: string;
  originalFilename: string;
}

// Atomically flip the next queued item to extracting. SQLite's single-writer
// model makes the read+update serialize, so two concurrent callers can't
// claim the same row.
function claimNext(): ClaimedItem | null {
  return db.transaction((tx) => {
    const next = tx
      .select({
        id: uploadBatchItems.id,
        batchId: uploadBatchItems.batchId,
        stagingId: uploadBatchItems.stagingId,
        fileHash: uploadBatchItems.fileHash,
        originalFilename: uploadBatchItems.originalFilename,
      })
      .from(uploadBatchItems)
      .where(eq(uploadBatchItems.status, "queued"))
      .orderBy(uploadBatchItems.id)
      .limit(1)
      .get();
    if (!next || !next.stagingId) return null;

    tx.update(uploadBatchItems)
      .set({ status: "extracting", updatedAt: sql`(CURRENT_TIMESTAMP)` })
      .where(
        and(
          eq(uploadBatchItems.id, next.id),
          eq(uploadBatchItems.status, "queued"),
        ),
      )
      .run();

    return {
      id: next.id,
      batchId: next.batchId,
      stagingId: next.stagingId,
      fileHash: next.fileHash,
      originalFilename: next.originalFilename,
    };
  });
}

function hasQueued(): boolean {
  const row = db
    .select({ id: uploadBatchItems.id })
    .from(uploadBatchItems)
    .where(eq(uploadBatchItems.status, "queued"))
    .limit(1)
    .get();
  return !!row;
}

async function processItem(item: ClaimedItem): Promise<void> {
  try {
    const dupe = findReportByHash(item.fileHash);
    if (dupe) {
      await discardStaged(item.stagingId).catch(() => {});
      db.update(uploadBatchItems)
        .set({
          status: "duplicate",
          stagingId: null,
          duplicateReportId: dupe.id,
          provider: dupe.provider,
          category: dupe.category,
          reportDate: dupe.reportDate ?? null,
          updatedAt: sql`(CURRENT_TIMESTAMP)`,
        })
        .where(eq(uploadBatchItems.id, item.id))
        .run();
      return;
    }

    const pdfPath = path.join(stagingDir(), item.stagingId, STAGING_PDF);
    const result = await extractReportFromPdf(pdfPath);
    const finalPath = await promoteStaged(item.stagingId, item.fileHash);
    const persisted = insertExtractedReport({
      filePath: finalPath,
      fileHash: item.fileHash,
      extraction: result.report,
      rawJson: result.raw,
      model: result.model,
    });

    db.update(uploadBatchItems)
      .set({
        status: "saved",
        stagingId: null,
        reportId: persisted.reportId,
        provider: result.report.provider,
        category: result.report.category,
        reportDate: result.report.reportDate ?? null,
        metricCount: persisted.metricCount,
        model: result.model,
        elapsedMs: result.elapsedMs,
        updatedAt: sql`(CURRENT_TIMESTAMP)`,
      })
      .where(eq(uploadBatchItems.id, item.id))
      .run();
  } catch (err) {
    await discardStaged(item.stagingId).catch(() => {});

    // If a concurrent worker (or a prior run) already saved this hash,
    // treat this as a duplicate rather than a hard error. Defends against
    // races and retried items.
    const landed = findReportByHash(item.fileHash);
    if (landed) {
      db.update(uploadBatchItems)
        .set({
          status: "duplicate",
          stagingId: null,
          duplicateReportId: landed.id,
          provider: landed.provider,
          category: landed.category,
          reportDate: landed.reportDate ?? null,
          errorMessage: null,
          updatedAt: sql`(CURRENT_TIMESTAMP)`,
        })
        .where(eq(uploadBatchItems.id, item.id))
        .run();
      return;
    }

    db.update(uploadBatchItems)
      .set({
        status: "error",
        stagingId: null,
        errorMessage: (err as Error).message.slice(0, 4000),
        updatedAt: sql`(CURRENT_TIMESTAMP)`,
      })
      .where(eq(uploadBatchItems.id, item.id))
      .run();
    console.error(
      `[batch-runner] item ${item.id} (${item.originalFilename}) failed:`,
      err,
    );
  }
}

// Reset items stuck in "extracting" from a dead process back to queued.
// Only touches rows whose updatedAt is older than STALE_EXTRACTING_MINUTES —
// active workers keep updatedAt fresh by touching it at claim time, so this
// never flips a live extraction.
export function recoverStuckItems(): number {
  const res = db
    .update(uploadBatchItems)
    .set({ status: "queued", updatedAt: sql`(CURRENT_TIMESTAMP)` })
    .where(
      and(
        eq(uploadBatchItems.status, "extracting"),
        sql`${uploadBatchItems.updatedAt} < datetime('now', ${`-${STALE_EXTRACTING_MINUTES} minutes`})`,
      ),
    )
    .run();
  return res.changes ?? 0;
}

export interface BatchItemView {
  id: number;
  originalFilename: string;
  sizeBytes: number;
  fileHash: string;
  status: string;
  reportId: number | null;
  duplicateReportId: number | null;
  provider: string | null;
  category: string | null;
  reportDate: string | null;
  metricCount: number | null;
  errorMessage: string | null;
}

export interface BatchView {
  id: number;
  createdAt: string;
  totalCount: number;
  counts: Record<string, number>;
  items: BatchItemView[];
}

export function getBatch(batchId: number): BatchView | null {
  const meta = db
    .select()
    .from(uploadBatches)
    .where(eq(uploadBatches.id, batchId))
    .get();
  if (!meta) return null;

  const rows = db
    .select()
    .from(uploadBatchItems)
    .where(eq(uploadBatchItems.batchId, batchId))
    .orderBy(uploadBatchItems.id)
    .all();

  const counts: Record<string, number> = {};
  const items: BatchItemView[] = rows.map((it) => {
    counts[it.status] = (counts[it.status] ?? 0) + 1;
    return {
      id: it.id,
      originalFilename: it.originalFilename,
      sizeBytes: it.sizeBytes,
      fileHash: it.fileHash,
      status: it.status,
      reportId: it.reportId,
      duplicateReportId: it.duplicateReportId,
      provider: it.provider,
      category: it.category,
      reportDate: it.reportDate,
      metricCount: it.metricCount,
      errorMessage: it.errorMessage,
    };
  });

  return {
    id: meta.id,
    createdAt: meta.createdAt,
    totalCount: meta.totalCount,
    counts,
    items,
  };
}

export interface BatchSummary {
  id: number;
  createdAt: string;
  totalCount: number;
  counts: Record<string, number>;
}

export function listRecentBatches(limit = 20): BatchSummary[] {
  const batches = db
    .select()
    .from(uploadBatches)
    .orderBy(sql`${uploadBatches.id} DESC`)
    .limit(limit)
    .all();
  if (batches.length === 0) return [];

  const ids = batches.map((b) => b.id);
  const rows = db
    .select({
      batchId: uploadBatchItems.batchId,
      status: uploadBatchItems.status,
    })
    .from(uploadBatchItems)
    .where(inArray(uploadBatchItems.batchId, ids))
    .all();

  const countsByBatch = new Map<number, Record<string, number>>();
  for (const r of rows) {
    const c = countsByBatch.get(r.batchId) ?? {};
    c[r.status] = (c[r.status] ?? 0) + 1;
    countsByBatch.set(r.batchId, c);
  }

  return batches.map((b) => ({
    id: b.id,
    createdAt: b.createdAt,
    totalCount: b.totalCount,
    counts: countsByBatch.get(b.id) ?? {},
  }));
}
