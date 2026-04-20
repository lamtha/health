CREATE TABLE `canonical_metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`canonical_name` text NOT NULL,
	`category` text NOT NULL,
	`preferred_units` text,
	`description` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `canonical_metrics_canonical_name_unique` ON `canonical_metrics` (`canonical_name`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`occurred_on` text NOT NULL,
	`kind` text NOT NULL,
	`description` text
);
--> statement-breakpoint
CREATE TABLE `extractions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`report_id` integer NOT NULL,
	`model` text NOT NULL,
	`raw_json` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`report_id` integer NOT NULL,
	`panel_id` integer,
	`canonical_metric_id` integer,
	`name` text NOT NULL,
	`value_numeric` real,
	`value_text` text,
	`units` text,
	`ref_low` real,
	`ref_high` real,
	`flag` text,
	FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`panel_id`) REFERENCES `panels`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`canonical_metric_id`) REFERENCES `canonical_metrics`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `panels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`report_id` integer NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_path` text NOT NULL,
	`file_hash` text NOT NULL,
	`provider` text NOT NULL,
	`category` text NOT NULL,
	`report_date` text,
	`uploaded_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reports_file_hash_unique` ON `reports` (`file_hash`);