CREATE TABLE `upload_batch_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` integer NOT NULL,
	`original_filename` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`file_hash` text NOT NULL,
	`staging_id` text,
	`status` text NOT NULL,
	`report_id` integer,
	`duplicate_report_id` integer,
	`provider` text,
	`category` text,
	`report_date` text,
	`metric_count` integer,
	`model` text,
	`elapsed_ms` integer,
	`error_message` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `upload_batches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`duplicate_report_id`) REFERENCES `reports`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `upload_batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`total_count` integer NOT NULL
);
