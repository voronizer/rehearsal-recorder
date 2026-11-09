CREATE TABLE `band_set` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` text NOT NULL,
	`made_by` text,
	`changed_by` text,
	`trashed_at` text,
	`trashed_by` text,
	FOREIGN KEY (`made_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`changed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trashed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `band_set_name_nocase` ON `band_set` ("name" COLLATE NOCASE) WHERE "band_set"."trashed_at" IS NULL;--> statement-breakpoint
CREATE TABLE `set_song` (
	`set_id` integer NOT NULL,
	`song_id` integer NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`set_id`, `song_id`),
	FOREIGN KEY (`set_id`) REFERENCES `band_set`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`song_id`) REFERENCES `song`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `set_song_song_idx` ON `set_song` (`song_id`);--> statement-breakpoint
ALTER TABLE `song` ADD `typed_length` integer;