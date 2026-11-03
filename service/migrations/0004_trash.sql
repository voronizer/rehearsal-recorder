ALTER TABLE `song` ADD `trashed_at` text;--> statement-breakpoint
ALTER TABLE `song` ADD `trashed_by` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `take` ADD `trashed_by` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `take` ADD `with_song` integer DEFAULT false NOT NULL;