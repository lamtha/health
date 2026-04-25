import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const reports = sqliteTable("reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  filePath: text("file_path").notNull(),
  fileHash: text("file_hash").notNull().unique(),
  provider: text("provider").notNull(),
  category: text("category").notNull(),
  reportDate: text("report_date"),
  uploadedAt: text("uploaded_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export const panels = sqliteTable("panels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reportId: integer("report_id")
    .notNull()
    .references(() => reports.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
});

export const canonicalMetrics = sqliteTable("canonical_metrics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  canonicalName: text("canonical_name").notNull().unique(),
  category: text("category").notNull(),
  tags: text("tags", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  preferredUnits: text("preferred_units"),
  description: text("description"),
});

// Seen raw metric names mapped to canonical metrics. Populated during
// ingest (exact-match lookup) and via /mappings (human review). The
// provider scope lets the same raw name resolve differently per lab when
// needed; provider = "" means a global fallback alias. An empty-string
// sentinel is used rather than NULL because SQLite treats NULL as distinct
// from NULL inside primary keys, which would defeat the uniqueness.
export const metricAliases = sqliteTable(
  "metric_aliases",
  {
    rawNameLower: text("raw_name_lower").notNull(),
    provider: text("provider").notNull().default(""),
    canonicalMetricId: integer("canonical_metric_id")
      .notNull()
      .references(() => canonicalMetrics.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.rawNameLower, t.provider] }),
  }),
);

export const metrics = sqliteTable("metrics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reportId: integer("report_id")
    .notNull()
    .references(() => reports.id, { onDelete: "cascade" }),
  panelId: integer("panel_id").references(() => panels.id, {
    onDelete: "set null",
  }),
  canonicalMetricId: integer("canonical_metric_id").references(
    () => canonicalMetrics.id,
    { onDelete: "set null" },
  ),
  name: text("name").notNull(),
  valueNumeric: real("value_numeric"),
  valueText: text("value_text"),
  units: text("units"),
  refLow: real("ref_low"),
  refHigh: real("ref_high"),
  flag: text("flag"),
});

export const extractions = sqliteTable("extractions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reportId: integer("report_id")
    .notNull()
    .references(() => reports.id, { onDelete: "cascade" }),
  // "claude" | "deterministic". Distinguishes the cloud Anthropic API from
  // a local rule-based parser in lib/parsers/*.
  extractorKind: text("extractor_kind").notNull().default("claude"),
  // Engine identifier — for claude, the model id ("claude-sonnet-4-6");
  // for deterministic, the parser name ("gimap"). Kept as free text so
  // future parsers slot in without a migration.
  model: text("model").notNull(),
  // Deterministic parser version. Lets us re-extract reports parsed by an
  // older parser when its rules improve. Null for Claude.
  extractorVersion: integer("extractor_version"),
  // Number of metric rows this extraction produced. Snapshot at insert;
  // doesn't track later metric edits but those don't happen today.
  metricCount: integer("metric_count").notNull().default(0),
  // Wall time of the extraction call in ms. Null for historical rows
  // pre-dating this column.
  elapsedMs: integer("elapsed_ms"),
  rawJson: text("raw_json", { mode: "json" }).notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export const interventions = sqliteTable("interventions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // supplement | med | diet | protocol
  kind: text("kind").notNull(),
  // Current dose text — dose history lives in kind:change events.
  dose: text("dose"),
  notes: text("notes"),
  startedOn: text("started_on").notNull(),
  // NULL = currently active.
  stoppedOn: text("stopped_on"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  occurredOn: text("occurred_on").notNull(),
  // start | stop | change | singleton
  kind: text("kind").notNull(),
  description: text("description"),
  interventionId: integer("intervention_id").references(
    () => interventions.id,
    { onDelete: "cascade" },
  ),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export const uploadBatches = sqliteTable("upload_batches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  totalCount: integer("total_count").notNull(),
});

// Bulk mapping runs — one row per `POST /api/mappings/runs` invocation
// (or `pnpm bulk-map` from the CLI). Carries the batch-runner state so
// a mid-run crash can resume on next boot, and the review UI can poll
// progress without re-querying Claude.
export const mappingRuns = sqliteTable("mapping_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // queued | proposing | ready_for_review | applying | applied | error | canceled
  status: text("status").notNull().default("queued"),
  model: text("model").notNull(),
  batchSize: integer("batch_size").notNull(),
  limitN: integer("limit_n"),
  totalUnmapped: integer("total_unmapped").notNull().default(0),
  batchesTotal: integer("batches_total").notNull().default(0),
  batchesDone: integer("batches_done").notNull().default(0),
  proposedCount: integer("proposed_count").notNull().default(0),
  // JSON arrays — failed batches carry {batchIdx, error, names[]}; missing
  // names are raw names Claude didn't return a proposal for.
  failedBatchesJson: text("failed_batches_json").notNull().default("[]"),
  missingNamesJson: text("missing_names_json").notNull().default("[]"),
  errorMessage: text("error_message"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  appliedAt: text("applied_at"),
});

// One proposal per raw unmapped name encountered in a run. Holds everything
// the apply phase needs so it never has to re-consult Claude.
export const mappingProposals = sqliteTable(
  "mapping_proposals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id")
      .notNull()
      .references(() => mappingRuns.id, { onDelete: "cascade" }),
    rawName: text("raw_name").notNull(),
    rawNameLower: text("raw_name_lower").notNull(),
    occurrenceCount: integer("occurrence_count").notNull().default(0),
    sampleProvidersJson: text("sample_providers_json").notNull().default("[]"),
    // map_existing | create_new | skip
    action: text("action").notNull(),
    canonicalMetricId: integer("canonical_metric_id").references(
      () => canonicalMetrics.id,
      { onDelete: "set null" },
    ),
    proposedCanonicalName: text("proposed_canonical_name"),
    // Full {canonicalName, category, tags, preferredUnits, description}
    // payload for create_new proposals. Editable via PATCH.
    newCanonicalJson: text("new_canonical_json"),
    extraAliasesJson: text("extra_aliases_json").notNull().default("[]"),
    confidence: real("confidence").notNull().default(0),
    reason: text("reason"),
    // pending | approved | rejected | applied | apply_error
    status: text("status").notNull().default("pending"),
    editedByUser: integer("edited_by_user").notNull().default(0),
    applyError: text("apply_error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => ({
    runStatusIdx: index("mapping_proposals_run_status_idx").on(
      t.runId,
      t.status,
    ),
    runRawUnique: uniqueIndex("mapping_proposals_run_raw_unique").on(
      t.runId,
      t.rawNameLower,
    ),
  }),
);

export const uploadBatchItems = sqliteTable("upload_batch_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  batchId: integer("batch_id")
    .notNull()
    .references(() => uploadBatches.id, { onDelete: "cascade" }),
  originalFilename: text("original_filename").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  fileHash: text("file_hash").notNull(),
  stagingId: text("staging_id"),
  status: text("status").notNull(),
  reportId: integer("report_id").references(() => reports.id, {
    onDelete: "set null",
  }),
  duplicateReportId: integer("duplicate_report_id").references(
    () => reports.id,
    { onDelete: "set null" },
  ),
  // The extraction this run produced. Null until the item reaches "saved";
  // also null for re-extracts (those produce extraction rows with no
  // batch-item link). Display fields (provider, category, report_date,
  // model, metric_count, elapsed_ms) are intentionally not denormalized
  // here — derive via report_id/duplicate_report_id → reports and
  // extraction_id → extractions.
  extractionId: integer("extraction_id").references(() => extractions.id, {
    onDelete: "set null",
  }),
  errorMessage: text("error_message"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});
