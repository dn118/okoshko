CREATE TABLE `allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`email` text NOT NULL,
	`service` text NOT NULL,
	`master` text NOT NULL,
	`date` text NOT NULL,
	`start` integer NOT NULL,
	`duration` integer NOT NULL,
	`wait_id` text,
	`expires` integer,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cells` (
	`key` text PRIMARY KEY NOT NULL,
	`allocation_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`recipient` text NOT NULL,
	`allocation_id` text,
	`created` integer NOT NULL,
	`seen` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `waiters` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`email` text NOT NULL,
	`service` text NOT NULL,
	`master` text NOT NULL,
	`date` text NOT NULL,
	`from_minute` integer NOT NULL,
	`to_minute` integer NOT NULL,
	`notice` integer NOT NULL,
	`status` text NOT NULL,
	`created` integer NOT NULL
);
