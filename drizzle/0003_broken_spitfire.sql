CREATE TABLE `telegram_connect` (
	`customer_id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_connect_token_hash_unique` ON `telegram_connect` (`token_hash`);--> statement-breakpoint
CREATE TABLE `telegram_delivery` (
	`message_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease` text,
	`error_code` text,
	`external_id` text,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `telegram_links` (
	`customer_id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_links_chat_id_unique` ON `telegram_links` (`chat_id`);--> statement-breakpoint
CREATE TABLE `telegram_tickets` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`expires` integer NOT NULL
);
