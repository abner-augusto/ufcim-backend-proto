-- Add new columns to users (ALTER TABLE ADD COLUMN is safe in SQLite/D1)
ALTER TABLE `users` ADD `is_master_admin` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD `disabled_at` text;
--> statement-breakpoint

-- Recreate users table to relax registration to nullable and replace unique with partial unique index.
-- PRAGMA foreign_keys=OFF and ON must be in the same connection as the DROP TABLE.
-- We execute the entire table swap as one statement block (no statement-breakpoint inside).
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`registration` text,
	`role` text NOT NULL,
	`department` text NOT NULL,
	`email` text NOT NULL,
	`is_master_admin` integer DEFAULT false NOT NULL,
	`disabled_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
INSERT INTO `__new_users` SELECT `id`, `name`, `registration`, `role`, `department`, `email`, `is_master_admin`, `disabled_at`, `created_at`, `updated_at` FROM `users`;
PRAGMA foreign_keys=OFF;
DROP TABLE `users`;
PRAGMA foreign_keys=ON;
ALTER TABLE `__new_users` RENAME TO `users`;
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
CREATE UNIQUE INDEX `users_registration_unq` ON `users` (`registration`) WHERE registration IS NOT NULL;
--> statement-breakpoint

-- Create user_credentials table
CREATE TABLE `user_credentials` (
	`user_id` text PRIMARY KEY NOT NULL,
	`password_hash` text NOT NULL,
	`password_updated_at` text NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade
);
--> statement-breakpoint

-- Create invitations table
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`name` text NOT NULL,
	`registration` text,
	`department` text NOT NULL,
	`token_hash` text NOT NULL,
	`invited_by` text NOT NULL,
	`expires_at` text NOT NULL,
	`accepted_at` text,
	`accepted_user_id` text,
	`revoked_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`),
	FOREIGN KEY (`accepted_user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint

CREATE UNIQUE INDEX `invitations_token_hash_unique` ON `invitations` (`token_hash`);
--> statement-breakpoint

-- Create refresh_tokens table
CREATE TABLE `refresh_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`replaced_by` text,
	`user_agent` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade
);
--> statement-breakpoint

CREATE UNIQUE INDEX `refresh_tokens_token_hash_unique` ON `refresh_tokens` (`token_hash`);
