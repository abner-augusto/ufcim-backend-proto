CREATE TABLE `equipment_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`equipment_id` text NOT NULL,
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
	FOREIGN KEY (`reported_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`acknowledged_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `equipment_reports_equipment_idx` ON `equipment_reports` (`equipment_id`);--> statement-breakpoint
CREATE INDEX `equipment_reports_status_idx` ON `equipment_reports` (`status`);--> statement-breakpoint
CREATE INDEX `equipment_reports_created_at_idx` ON `equipment_reports` (`created_at`);