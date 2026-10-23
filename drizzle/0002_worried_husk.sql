ALTER TABLE `allocations` ADD `customer_id` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `customer_id` text;--> statement-breakpoint
ALTER TABLE `waiters` ADD `customer_id` text;