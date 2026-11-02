CREATE TABLE `level` (
	`member_id` text NOT NULL,
	`track` text NOT NULL,
	`level` real NOT NULL,
	PRIMARY KEY(`member_id`, `track`),
	FOREIGN KEY (`member_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
