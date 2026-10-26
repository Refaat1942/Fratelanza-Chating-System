import { pgTable, serial, integer, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { customersTable } from "./customers";

export const conversationsTable = pgTable("conversations", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id")
    .notNull()
    .references(() => customersTable.id),
  assignedAgentId: integer("assigned_agent_id").references(
    () => usersTable.id,
  ),
  status: text("status", { enum: ["open", "completed", "pending"] })
    .notNull()
    .default("open"),
  channel: text("channel", {
    enum: ["whatsapp", "messenger", "instagram", "sms", "web"],
  })
    .notNull()
    .default("whatsapp"),
  tags: text("tags").array().notNull().default([]),
  lastMessage: text("last_message"),
  lastMessageAt: timestamp("last_message_at"),
  lastSenderType: text("last_sender_type", {
    enum: ["agent", "customer", "system"],
  }),
  unreadCount: integer("unread_count").notNull().default(0),
  chatReasonId: integer("chat_reason_id"),
  // true = topic was picked by the keyword classifier (it may re-file the chat);
  // false = a person chose it, so automation never overrides it.
  chatReasonAuto: boolean("chat_reason_auto").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
  queuedAt: timestamp("queued_at"),
});

export const insertConversationSchema = createInsertSchema(
  conversationsTable,
).omit({ id: true, createdAt: true });
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Conversation = typeof conversationsTable.$inferSelect;
