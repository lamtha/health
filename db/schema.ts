import { sql } from "drizzle-orm";
import {
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
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
  model: text("model").notNull(),
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
  provider: text("provider"),
  category: text("category"),
  reportDate: text("report_date"),
  metricCount: integer("metric_count"),
  model: text("model"),
  elapsedMs: integer("elapsed_ms"),
  errorMessage: text("error_message"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});
