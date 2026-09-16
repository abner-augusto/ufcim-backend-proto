ALTER TABLE `blockings` ADD `batch_id` text;--> statement-breakpoint
CREATE INDEX `blockings_batch_idx` ON `blockings` (`batch_id`);