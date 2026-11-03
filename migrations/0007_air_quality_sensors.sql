CREATE TABLE `sensor_collectors` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`last_seen_at` text,
	`last_version` text,
	`revoked_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sensor_collectors_token_hash_unique` ON `sensor_collectors` (`token_hash`);--> statement-breakpoint
CREATE TABLE `sensor_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`external_id` text NOT NULL,
	`vendor` text NOT NULL,
	`model` text NOT NULL,
	`label` text,
	`collector_id` text NOT NULL,
	`space_id` text,
	`last_status` text,
	`last_status_at` text,
	`last_error` text,
	`retired_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`collector_id`) REFERENCES `sensor_collectors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sensor_devices_external_id_unique` ON `sensor_devices` (`external_id`);--> statement-breakpoint
CREATE INDEX `sensor_devices_space_idx` ON `sensor_devices` (`space_id`);--> statement-breakpoint
CREATE TABLE `sensor_readings` (
	`device_id` text NOT NULL,
	`measured_at` text NOT NULL,
	`received_at` text NOT NULL,
	`co2_ppm` real,
	`pm1_ugm3` real,
	`pm25_ugm3` real,
	`pm10_ugm3` real,
	`tvoc_mgm3` real,
	`hcho_mgm3` real,
	`temperature_c` real,
	`humidity_pct` real,
	`battery_pct` integer,
	PRIMARY KEY(`device_id`, `measured_at`),
	FOREIGN KEY (`device_id`) REFERENCES `sensor_devices`(`id`) ON UPDATE no action ON DELETE no action
);
