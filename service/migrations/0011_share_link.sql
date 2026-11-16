CREATE TABLE `share_link` (
	`id` text PRIMARY KEY NOT NULL,
	`take_uid` text NOT NULL,
	`made_by` text NOT NULL,
	`made_at` text NOT NULL,
	`for_whom` text DEFAULT '' NOT NULL,
	`shows` text NOT NULL,
	`download` text NOT NULL,
	`until` text,
	`heard` text,
	`mix_gen` integer,
	`mix_sec` real,
	`ready` integer NOT NULL,
	`sending` integer DEFAULT false NOT NULL,
	`plays` integer DEFAULT 0 NOT NULL,
	`last_played_at` text,
	FOREIGN KEY (`take_uid`) REFERENCES `take`(`uid`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`made_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `share_link_take_idx` ON `share_link` (`take_uid`);