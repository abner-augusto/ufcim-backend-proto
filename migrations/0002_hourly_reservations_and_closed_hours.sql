ALTER TABLE `spaces` ADD COLUMN `closed_from` text NOT NULL DEFAULT '22:00';
--> statement-breakpoint
ALTER TABLE `spaces` ADD COLUMN `closed_to` text NOT NULL DEFAULT '07:00';
--> statement-breakpoint
ALTER TABLE `reservations` ADD COLUMN `start_time` text NOT NULL DEFAULT '00:00';
--> statement-breakpoint
ALTER TABLE `reservations` ADD COLUMN `end_time` text NOT NULL DEFAULT '01:00';
--> statement-breakpoint
UPDATE `reservations`
SET
  `start_time` = CASE `time_slot`
    WHEN 'morning' THEN '09:00'
    WHEN 'afternoon' THEN '14:00'
    WHEN 'evening' THEN '19:00'
    ELSE '09:00'
  END,
  `end_time` = CASE `time_slot`
    WHEN 'morning' THEN '10:00'
    WHEN 'afternoon' THEN '15:00'
    WHEN 'evening' THEN '20:00'
    ELSE '10:00'
  END;
--> statement-breakpoint
ALTER TABLE `blockings` ADD COLUMN `start_time` text NOT NULL DEFAULT '00:00';
--> statement-breakpoint
ALTER TABLE `blockings` ADD COLUMN `end_time` text NOT NULL DEFAULT '01:00';
--> statement-breakpoint
UPDATE `blockings`
SET
  `start_time` = CASE `time_slot`
    WHEN 'morning' THEN '08:00'
    WHEN 'afternoon' THEN '15:00'
    WHEN 'evening' THEN '19:00'
    ELSE '08:00'
  END,
  `end_time` = CASE `time_slot`
    WHEN 'morning' THEN '09:00'
    WHEN 'afternoon' THEN '17:00'
    WHEN 'evening' THEN '20:00'
    ELSE '09:00'
  END;
