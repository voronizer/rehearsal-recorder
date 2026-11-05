ALTER TABLE `song` ADD `signature` text;--> statement-breakpoint
ALTER TABLE `song` ADD `title_by` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `song` ADD `meter_by` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `song` ADD `made_by` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `take` ADD `moved_by` text REFERENCES user(id);