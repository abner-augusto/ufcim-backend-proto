CREATE TABLE `rate_limit_buckets` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL DEFAULT 0,
	`window_start` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_limit_buckets_window_start_idx` ON `rate_limit_buckets` (`window_start`);
