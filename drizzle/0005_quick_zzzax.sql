ALTER TABLE `extractions` ADD `extractor_kind` text DEFAULT 'claude' NOT NULL;--> statement-breakpoint
ALTER TABLE `extractions` ADD `extractor_version` integer;--> statement-breakpoint
ALTER TABLE `extractions` ADD `metric_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `extractions` ADD `elapsed_ms` integer;--> statement-breakpoint
-- Backfill metric_count for existing extraction rows. Today every report
-- has exactly one effective metric set (re-extract replaces metrics in
-- place), so counting metrics per report and writing the same value to
-- every extraction row of that report is the correct historical value.
UPDATE `extractions` SET `metric_count` = (
  SELECT COUNT(*) FROM `metrics` WHERE `metrics`.`report_id` = `extractions`.`report_id`
);--> statement-breakpoint
ALTER TABLE `upload_batch_items` ADD `extraction_id` integer REFERENCES extractions(id);--> statement-breakpoint
ALTER TABLE `upload_batch_items` DROP COLUMN `provider`;--> statement-breakpoint
ALTER TABLE `upload_batch_items` DROP COLUMN `category`;--> statement-breakpoint
ALTER TABLE `upload_batch_items` DROP COLUMN `report_date`;--> statement-breakpoint
ALTER TABLE `upload_batch_items` DROP COLUMN `metric_count`;--> statement-breakpoint
ALTER TABLE `upload_batch_items` DROP COLUMN `model`;--> statement-breakpoint
ALTER TABLE `upload_batch_items` DROP COLUMN `elapsed_ms`;