CREATE TABLE `backing_heard` (
	`member_id` text NOT NULL,
	`song_id` integer NOT NULL,
	`heard` integer NOT NULL,
	PRIMARY KEY(`member_id`, `song_id`),
	FOREIGN KEY (`member_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`song_id`) REFERENCES `song`(`id`) ON UPDATE no action ON DELETE cascade
);
