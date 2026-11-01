CREATE TABLE `band` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`picture_at` text
);
--> statement-breakpoint
CREATE TABLE `label` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`colour` text NOT NULL,
	`position` integer NOT NULL,
	`was` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `label_name_nocase` ON `label` ("name" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `song_file` (
	`id` integer PRIMARY KEY NOT NULL,
	`song_id` integer NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`type` text NOT NULL,
	`size` integer NOT NULL,
	`member_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`song_id`) REFERENCES `song`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `song_file_song_idx` ON `song_file` (`song_id`);--> statement-breakpoint
CREATE TABLE `status` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `status_name_nocase` ON `status` ("name" COLLATE NOCASE);--> statement-breakpoint
ALTER TABLE `comment` ADD `label_id` integer REFERENCES label(id);--> statement-breakpoint
ALTER TABLE `comment` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `song` ADD `status_id` integer REFERENCES status(id);--> statement-breakpoint
ALTER TABLE `song` ADD `key` text;--> statement-breakpoint
ALTER TABLE `song` ADD `tempo` real;--> statement-breakpoint
ALTER TABLE `song` ADD `notes` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `song` ADD `created_at` text;--> statement-breakpoint
ALTER TABLE `take` ADD `shape` text;--> statement-breakpoint
-- What the band starts with: no name yet, РЭХА's four labels, three statuses.
INSERT INTO `band` (`id`, `name`) VALUES (1, '');--> statement-breakpoint
INSERT INTO `status` (`name`, `position`) VALUES ('Learning', 0), ('Ready', 1), ('Archive', 2);--> statement-breakpoint
INSERT INTO `label` (`name`, `colour`, `position`) VALUES ('Note', 'grey', 0), ('Keep this', 'green', 1), ('Went wrong', 'red', 2), ('Do again', 'amber', 3);--> statement-breakpoint
-- Part 1's marks from РЭХА: a label for each name the band has not got, in
-- РЭХА's colour (grey for one that is not among РЭХА's eight), in the order
-- they first came.
INSERT INTO `label` (`name`, `colour`, `position`)
SELECT `label`,
  CASE WHEN `colour` IN ('grey', 'red', 'amber', 'green', 'teal', 'blue', 'violet', 'pink') THEN `colour` ELSE 'grey' END,
  3 + ROW_NUMBER() OVER (ORDER BY `first`)
FROM (
  SELECT `label`, `colour`, MIN(`id`) AS `first` FROM `comment`
  WHERE `from_reha` = 1 AND `parent_id` IS NULL AND trim(coalesce(`label`, '')) <> ''
    AND lower(`label`) NOT IN (SELECT lower(`name`) FROM `label`)
  GROUP BY lower(`label`)
);--> statement-breakpoint
UPDATE `comment` SET `label_id` = (SELECT `id` FROM `label` WHERE `label`.`name` = `comment`.`label` COLLATE NOCASE)
WHERE `parent_id` IS NULL AND `from_reha` = 1;--> statement-breakpoint
-- A member's comment with no parent becomes a mark with the first label,
-- Note. Its replies are the comments under it already.
UPDATE `comment` SET `label_id` = (SELECT `id` FROM `label` ORDER BY `position` LIMIT 1)
WHERE `parent_id` IS NULL AND `label_id` IS NULL;--> statement-breakpoint
UPDATE `song` SET `status_id` = (SELECT `id` FROM `status` ORDER BY `position` LIMIT 1),
  `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');--> statement-breakpoint
ALTER TABLE `comment` DROP COLUMN `label`;--> statement-breakpoint
ALTER TABLE `comment` DROP COLUMN `colour`;
