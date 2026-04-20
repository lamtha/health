CREATE TABLE `mapping_proposals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`raw_name` text NOT NULL,
	`raw_name_lower` text NOT NULL,
	`occurrence_count` integer DEFAULT 0 NOT NULL,
	`sample_providers_json` text DEFAULT '[]' NOT NULL,
	`action` text NOT NULL,
	`canonical_metric_id` integer,
	`proposed_canonical_name` text,
	`new_canonical_json` text,
	`extra_aliases_json` text DEFAULT '[]' NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`reason` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`edited_by_user` integer DEFAULT 0 NOT NULL,
	`apply_error` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `mapping_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`canonical_metric_id`) REFERENCES `canonical_metrics`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `mapping_proposals_run_status_idx` ON `mapping_proposals` (`run_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `mapping_proposals_run_raw_unique` ON `mapping_proposals` (`run_id`,`raw_name_lower`);--> statement-breakpoint
CREATE TABLE `mapping_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`model` text NOT NULL,
	`batch_size` integer NOT NULL,
	`limit_n` integer,
	`total_unmapped` integer DEFAULT 0 NOT NULL,
	`batches_total` integer DEFAULT 0 NOT NULL,
	`batches_done` integer DEFAULT 0 NOT NULL,
	`proposed_count` integer DEFAULT 0 NOT NULL,
	`failed_batches_json` text DEFAULT '[]' NOT NULL,
	`missing_names_json` text DEFAULT '[]' NOT NULL,
	`error_message` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`started_at` text,
	`finished_at` text,
	`applied_at` text
);
