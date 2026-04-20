CREATE TABLE `interventions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`dose` text,
	`notes` text,
	`started_on` text NOT NULL,
	`stopped_on` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `events` ADD `intervention_id` integer REFERENCES interventions(id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `events` ADD `created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL;