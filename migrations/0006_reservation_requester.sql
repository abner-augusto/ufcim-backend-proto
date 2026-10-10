-- MEL-025: staff reserve on behalf of someone else.
-- `reservations` and `recurrences` gain the requester: a registered user
-- (`requester_user_id`) or free text (`requester_name`), plus an optional
-- `requester_contact`. `reservations.created_by` records who registered the
-- row; every existing row was registered by its owner, so it is backfilled
-- with `user_id`. `recurrences.created_by` already exists (NOT NULL).
--
-- SQLite cannot ADD a NOT NULL column that references another table, so
-- `reservations` is rebuilt to keep `created_by` NOT NULL. D1 runs each
-- migration in a transaction where `PRAGMA foreign_keys=OFF` is a no-op;
-- `defer_foreign_keys` postpones FK checks to the commit instead. No other
-- table references `reservations`, so the drop is FK-safe.
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
ALTER TABLE `recurrences` ADD `requester_user_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `recurrences` ADD `requester_name` text;--> statement-breakpoint
ALTER TABLE `recurrences` ADD `requester_contact` text;--> statement-breakpoint
CREATE TABLE `__new_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_by` text NOT NULL,
	`requester_user_id` text,
	`requester_name` text,
	`requester_contact` text,
	`date` text NOT NULL,
	`time_slot` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`status` text NOT NULL,
	`recurrence_id` text,
	`change_origin` text,
	`purpose` text,
	`description` text,
	`cancel_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requester_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recurrence_id`) REFERENCES `recurrences`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_reservations`("id", "space_id", "user_id", "created_by", "requester_user_id", "requester_name", "requester_contact", "date", "time_slot", "start_time", "end_time", "status", "recurrence_id", "change_origin", "purpose", "description", "cancel_reason", "created_at", "updated_at")
SELECT "id", "space_id", "user_id", "user_id", NULL, NULL, NULL, "date", "time_slot", "start_time", "end_time", "status", "recurrence_id", "change_origin", "purpose", "description", "cancel_reason", "created_at", "updated_at"
FROM `reservations`;--> statement-breakpoint
DROP TABLE `reservations`;--> statement-breakpoint
ALTER TABLE `__new_reservations` RENAME TO `reservations`;--> statement-breakpoint
CREATE UNIQUE INDEX `reservations_confirmed_slot_unq` ON `reservations` (`space_id`,`date`,`start_time`,`end_time`) WHERE status = 'confirmed';--> statement-breakpoint
CREATE INDEX `reservations_requester_idx` ON `reservations` (`requester_user_id`);
