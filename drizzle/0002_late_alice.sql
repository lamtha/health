CREATE TABLE `metric_aliases` (
	`raw_name_lower` text NOT NULL,
	`provider` text DEFAULT '' NOT NULL,
	`canonical_metric_id` integer NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	PRIMARY KEY(`raw_name_lower`, `provider`),
	FOREIGN KEY (`canonical_metric_id`) REFERENCES `canonical_metrics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `canonical_metrics` ADD `tags` text DEFAULT '[]' NOT NULL;