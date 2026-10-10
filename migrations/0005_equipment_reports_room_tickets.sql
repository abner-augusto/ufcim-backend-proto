-- MEL-026: room tickets by service category. `equipment_id` becomes nullable,
-- `space_id` (always set) and `category` (room tickets only) are added.
-- SQLite cannot relax NOT NULL in place, so the table is rebuilt.
-- D1 runs each migration in a transaction where `PRAGMA foreign_keys=OFF` is a
-- no-op; `defer_foreign_keys` postpones FK checks to the commit instead.
-- No other table references `equipment_reports`, so the drop is FK-safe.
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__new_equipment_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`equipment_id` text,
	`space_id` text NOT NULL,
	`category` text,
	`reported_by` text NOT NULL,
	`description` text NOT NULL,
	`severity` text NOT NULL,
	`status` text NOT NULL,
	`acknowledged_by` text,
	`acknowledged_at` text,
	`resolved_at` text,
	`dismissed_reason` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reported_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`acknowledged_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
-- Every existing row is an equipment ticket: its room comes from the equipment.
-- LEFT JOIN keeps every row; a ticket whose equipment were missing would hit
-- the NOT NULL on `space_id` and abort the migration instead of being dropped.
INSERT INTO `__new_equipment_reports`("id", "equipment_id", "space_id", "category", "reported_by", "description", "severity", "status", "acknowledged_by", "acknowledged_at", "resolved_at", "dismissed_reason", "created_at")
SELECT r."id", r."equipment_id", e."space_id", NULL, r."reported_by", r."description", r."severity", r."status", r."acknowledged_by", r."acknowledged_at", r."resolved_at", r."dismissed_reason", r."created_at"
FROM `equipment_reports` r
LEFT JOIN `equipment` e ON e."id" = r."equipment_id";--> statement-breakpoint
DROP TABLE `equipment_reports`;--> statement-breakpoint
ALTER TABLE `__new_equipment_reports` RENAME TO `equipment_reports`;--> statement-breakpoint
CREATE INDEX `equipment_reports_equipment_idx` ON `equipment_reports` (`equipment_id`);--> statement-breakpoint
CREATE INDEX `equipment_reports_status_idx` ON `equipment_reports` (`status`);--> statement-breakpoint
CREATE INDEX `equipment_reports_created_at_idx` ON `equipment_reports` (`created_at`);--> statement-breakpoint
CREATE INDEX `equipment_reports_space_category_idx` ON `equipment_reports` (`space_id`,`category`);
