CREATE TABLE `departments` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`campus` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rate_limit_buckets` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`window_start` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_limit_buckets_window_start_idx` ON `rate_limit_buckets` (`window_start`);--> statement-breakpoint
ALTER TABLE `notifications` ADD `created_at` text NOT NULL;--> statement-breakpoint
ALTER TABLE `notifications` DROP COLUMN `sent_at`;--> statement-breakpoint
ALTER TABLE `reservations` ADD `purpose` text;--> statement-breakpoint
ALTER TABLE `reservations` ADD `cancel_reason` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_spaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`number` text NOT NULL,
	`type` text NOT NULL,
	`block` text NOT NULL,
	`campus` text NOT NULL,
	`department` text NOT NULL,
	`capacity` integer NOT NULL,
	`furniture` text,
	`lighting` text,
	`hvac` text,
	`multimedia` text,
	`model_id` text,
	`reservable` integer DEFAULT true NOT NULL,
	`closed_from` text DEFAULT '22:00' NOT NULL,
	`closed_to` text DEFAULT '07:00' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`department`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_spaces`("id", "name", "number", "type", "block", "campus", "department", "capacity", "furniture", "lighting", "hvac", "multimedia", "model_id", "reservable", "closed_from", "closed_to", "created_at", "updated_at") SELECT "id", "name", "number", "type", "block", "campus", "department", "capacity", "furniture", "lighting", "hvac", "multimedia", "model_id", "reservable", "closed_from", "closed_to", "created_at", "updated_at" FROM `spaces`;--> statement-breakpoint
DROP TABLE `spaces`;--> statement-breakpoint
ALTER TABLE `__new_spaces` RENAME TO `spaces`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `spaces_model_id_unique` ON `spaces` (`model_id`);--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`registration` text,
	`role` text NOT NULL,
	`department` text NOT NULL,
	`email` text NOT NULL,
	`is_master_admin` integer DEFAULT false NOT NULL,
	`disabled_at` text,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`department`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "name", "registration", "role", "department", "email", "is_master_admin", "disabled_at", "deleted_at", "created_at", "updated_at") SELECT "id", "name", "registration", "role", "department", "email", "is_master_admin", "disabled_at", "deleted_at", "created_at", "updated_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_registration_unq` ON `users` (`registration`) WHERE registration IS NOT NULL;--> statement-breakpoint
CREATE INDEX `audit_logs_actor_idx` ON `audit_logs` (`user_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_action_idx` ON `audit_logs` (`action_type`);--> statement-breakpoint
CREATE INDEX `audit_logs_timestamp_idx` ON `audit_logs` (`timestamp`);--> statement-breakpoint
CREATE TABLE `__new_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`name` text NOT NULL,
	`registration` text,
	`department` text NOT NULL,
	`token_hash` text NOT NULL,
	`purpose` text DEFAULT 'invite' NOT NULL,
	`invited_by` text NOT NULL,
	`expires_at` text NOT NULL,
	`accepted_at` text,
	`accepted_user_id` text,
	`revoked_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`department`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accepted_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_invitations`("id", "email", "role", "name", "registration", "department", "token_hash", "purpose", "invited_by", "expires_at", "accepted_at", "accepted_user_id", "revoked_at", "created_at") SELECT "id", "email", "role", "name", "registration", "department", "token_hash", "purpose", "invited_by", "expires_at", "accepted_at", "accepted_user_id", "revoked_at", "created_at" FROM `invitations`;--> statement-breakpoint
DROP TABLE `invitations`;--> statement-breakpoint
ALTER TABLE `__new_invitations` RENAME TO `invitations`;--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_hash_unique` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invitations_email_idx` ON `invitations` (`email`);--> statement-breakpoint
CREATE INDEX `invitations_expires_at_idx` ON `invitations` (`expires_at`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_user_id_idx` ON `refresh_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_expires_at_idx` ON `refresh_tokens` (`expires_at`);