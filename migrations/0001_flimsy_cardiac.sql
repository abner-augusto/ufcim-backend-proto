ALTER TABLE `spaces` ADD `model_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `spaces_model_id_unique` ON `spaces` (`model_id`);
