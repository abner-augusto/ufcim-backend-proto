ALTER TABLE `equipment` ADD COLUMN `asset_id` text;
--> statement-breakpoint
UPDATE `equipment`
SET `asset_id` = CASE `id`
  WHEN '00000000-0000-0000-0000-000000000021' THEN '2020002658'
  WHEN '00000000-0000-0000-0000-000000000022' THEN '2020002659'
  ELSE substr(replace(`id`, '-', ''), 1, 10)
END
WHERE `asset_id` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `equipment_asset_id_unique` ON `equipment` (`asset_id`);
