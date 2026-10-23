import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const allocations = sqliteTable('allocations', {
  customerId: text('customer_id'),
  id: text('id').primaryKey(), token: text('token').notNull(), kind: text('kind').notNull(), status: text('status').notNull(),
  name: text('name').notNull(), phone: text('phone').notNull(), email: text('email').notNull(), service: text('service').notNull(), master: text('master').notNull(),
  date: text('date').notNull(), start: integer('start').notNull(), duration: integer('duration').notNull(), waitId: text('wait_id'), expires: integer('expires'), created: integer('created').notNull(),
});
export const cells = sqliteTable('cells', { key: text('key').primaryKey(), allocationId: text('allocation_id').notNull() });
export const waiters = sqliteTable('waiters', {
  customerId: text('customer_id'),
  id: text('id').primaryKey(), token: text('token').notNull(), name: text('name').notNull(), phone: text('phone').notNull(), email: text('email').notNull(),
  service: text('service').notNull(), master: text('master').notNull(), date: text('date').notNull(), from: integer('from_minute').notNull(), to: integer('to_minute').notNull(),
  notice: integer('notice').notNull(), status: text('status').notNull(), created: integer('created').notNull(), replacesId: text('replaces_id'),
});
export const messages = sqliteTable('messages', {customerId: text('customer_id'),id: text('id').primaryKey(), title: text('title').notNull(), body: text('body').notNull(), recipient: text('recipient').notNull(), allocationId: text('allocation_id'), created: integer('created').notNull(), seen: integer('seen').notNull().default(0)});
export const settings = sqliteTable('settings', { key: text('key').primaryKey(), value: text('value').notNull() });

export const telegramLinks=sqliteTable('telegram_links',{customerId:text('customer_id').primaryKey(),chatId:text('chat_id').notNull().unique(),created:integer('created').notNull()});
export const telegramConnect=sqliteTable('telegram_connect',{customerId:text('customer_id').primaryKey(),tokenHash:text('token_hash').notNull().unique(),expires:integer('expires').notNull()});
export const telegramDelivery=sqliteTable('telegram_delivery',{messageId:text('message_id').primaryKey(),status:text('status').notNull(),attempts:integer('attempts').notNull().default(0),lease:text('lease'),errorCode:text('error_code'),externalId:text('external_id'),updated:integer('updated').notNull()});
export const telegramTickets=sqliteTable('telegram_tickets',{tokenHash:text('token_hash').primaryKey(),customerId:text('customer_id').notNull(),chatId:text('chat_id').notNull(),expires:integer('expires').notNull()});
