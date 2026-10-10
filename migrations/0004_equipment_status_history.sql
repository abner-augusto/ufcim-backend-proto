CREATE TABLE `equipment_status_history` (
	`id` text PRIMARY KEY NOT NULL,
	`equipment_id` text NOT NULL,
	`from_status` text NOT NULL,
	`to_status` text NOT NULL,
	`changed_by` text,
	`changed_at` text NOT NULL,
	`source` text NOT NULL,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`changed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `equipment_status_history_equipment_changed_idx` ON `equipment_status_history` (`equipment_id`,`changed_at`);--> statement-breakpoint
CREATE INDEX `equipment_status_history_changed_at_idx` ON `equipment_status_history` (`changed_at`);--> statement-breakpoint
-- MEL-013 baseline: one 'system' row per equipment recording its status when
-- history collection starts. Not a backfill: it only anchors the current state,
-- so an item already broken at deploy time counts broken time from here on.
INSERT INTO `equipment_status_history` (`id`, `equipment_id`, `from_status`, `to_status`, `changed_by`, `changed_at`, `source`)
SELECT lower(hex(randomblob(16))), `id`, `status`, `status`, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system' FROM `equipment`;