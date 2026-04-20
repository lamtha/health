import fs from "node:fs";
import path from "node:path";

// Tiny .env loader so the script runs without adding a dotenv dependency.
function loadEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

import {
  applyRun,
  computeSeedDiff,
  createMappingRun,
  DEFAULT_MAPPING_BATCH_SIZE,
  DEFAULT_MAPPING_MODEL,
  drainMappingRuns,
  getRun,
  listRuns,
  runFixupOnRun,
} from "@/lib/bulk-map";

// ─── CLI ─────────────────────────────────────────────────────────────────

async function propose(opts: {
  limit?: number;
  batchSize: number;
  model: string;
}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is required. Set it in .env before running bulk-map.",
    );
  }

  const created = createMappingRun({
    model: opts.model,
    batchSize: opts.batchSize,
    limit: opts.limit,
  });
  console.log(
    `[bulk-map] run #${created.runId} queued: ${created.totalUnmapped} distinct unmapped names, ${created.batchesTotal} batches of ${opts.batchSize}`,
  );

  await drainMappingRuns();

  const final = getRun(created.runId);
  if (!final) {
    throw new Error(`run ${created.runId} disappeared`);
  }
  const byAction = final.actionCounts;
  console.log(
    [
      `[bulk-map] run #${created.runId} finished — status: ${final.status}`,
      `             proposals:       ${final.proposedCount}`,
      `             map_existing:    ${byAction.map_existing ?? 0}`,
      `             create_new:      ${byAction.create_new ?? 0}`,
      `             skip:            ${byAction.skip ?? 0}`,
      `             missing:         ${final.missingNames.length}`,
      `             failed batches:  ${final.failedBatches.length}`,
      ``,
      `Review via \`pnpm dev\` → /mappings, then apply with:`,
      `  pnpm bulk-map --apply --run=${created.runId}`,
    ].join("\n"),
  );
  if (final.failedBatches.length) {
    console.warn(`[bulk-map] ⚠ failed batches:`);
    for (const b of final.failedBatches) {
      console.warn(`            batch ${b.batchIdx}: ${b.error.slice(0, 120)}`);
      console.warn(
        `              first names: ${b.names.slice(0, 3).join(", ")}${b.names.length > 3 ? ", …" : ""}`,
      );
    }
  }
}

function resolveRunId(explicit: number | undefined): number {
  if (explicit != null) return explicit;
  const recent = listRuns(5);
  const reviewable = recent.find(
    (r) => r.status === "ready_for_review" || r.status === "error",
  );
  if (!reviewable) {
    throw new Error(
      "No run with status=ready_for_review or error found. Pass --run=<id> or run `pnpm bulk-map` first.",
    );
  }
  return reviewable.id;
}

function fixup(opts: { runId?: number }) {
  const runId = resolveRunId(opts.runId);
  const summary = runFixupOnRun(runId);
  console.log(
    [
      `[bulk-map] fixup applied to run #${runId}`,
      `             lossy map_existing fixed: ${summary.lossyFixed}`,
      `             skips self-healed:         ${summary.selfHealed}`,
      `             "other" recategorized:     ${summary.recategorized}`,
      ...Object.entries(summary.recatCounts).map(
        ([slug, n]) => `                 → ${slug}: ${n}`,
      ),
    ].join("\n"),
  );
}

function apply(opts: { runId?: number; includeUnreviewed: boolean }) {
  const runId = resolveRunId(opts.runId);
  const result = applyRun(runId, {
    includeUnreviewed: opts.includeUnreviewed,
  });
  console.log(
    [
      `[bulk-map] applied run #${runId}`,
      `             proposals applied:    ${result.proposalsApplied}`,
      `             proposals skipped:    ${result.proposalsSkipped}`,
      `             proposals failed:     ${result.proposalsFailed}`,
      `             canonicals inserted:  ${result.canonicalsInserted}`,
      `             aliases inserted:     ${result.aliasesInserted}`,
      `             aliases updated:      ${result.aliasesUpdated}`,
      `             metric rows linked:   ${result.metricsBackfilled}`,
    ].join("\n"),
  );
}

function exportSeed(opts: { outPath?: string }) {
  const diff = computeSeedDiff();
  if (opts.outPath) {
    fs.writeFileSync(opts.outPath, diff.formatted);
    console.log(
      `[bulk-map] wrote ${diff.newCanonicals.length} new canonicals + ${diff.aliasAdditions.length} alias additions → ${opts.outPath}`,
    );
  } else {
    process.stdout.write(diff.formatted);
    console.error(
      `[bulk-map] exported ${diff.newCanonicals.length} new canonicals + ${diff.aliasAdditions.length} alias additions`,
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isApply = args.includes("--apply");
  const isExportSeed = args.includes("--export-seed");
  const isFixup = args.includes("--fixup");
  const outArg = args.find((a) => a.startsWith("--out="))?.split("=", 2)[1];
  const limitArg = args.find((a) => a.startsWith("--limit="))?.split("=", 2)[1];
  const batchArg = args
    .find((a) => a.startsWith("--batch-size="))
    ?.split("=", 2)[1];
  const runArg = args.find((a) => a.startsWith("--run="))?.split("=", 2)[1];
  const modelArg = args.find((a) => a.startsWith("--model="))?.split("=", 2)[1];
  const includeUnreviewed = args.includes("--include-unreviewed");

  const runId = runArg ? Number(runArg) : undefined;

  if (isExportSeed) {
    exportSeed({ outPath: outArg ? path.resolve(outArg) : undefined });
    return;
  }

  if (isFixup) {
    fixup({ runId });
    return;
  }

  if (isApply) {
    apply({ runId, includeUnreviewed });
    return;
  }

  const limit = limitArg ? Number(limitArg) : undefined;
  const batchSize = batchArg ? Number(batchArg) : DEFAULT_MAPPING_BATCH_SIZE;
  const model = modelArg ?? DEFAULT_MAPPING_MODEL;
  if (limit !== undefined && !Number.isFinite(limit))
    throw new Error(`--limit must be a number, got ${limitArg}`);
  if (!Number.isFinite(batchSize) || batchSize < 1)
    throw new Error(`--batch-size must be a positive number, got ${batchArg}`);

  await propose({ limit, batchSize, model });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
