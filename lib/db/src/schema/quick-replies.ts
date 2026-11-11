import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/** Speed-message categories (Greetings, Pricing, Delivery, …). */
export const quickReplyCategoriesTable = pgTable("quick_reply_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Speed messages. Body may contain variables ({{customer_name}}, {{agent_name}}
 * …) filled in when inserted. Visibility: "all" (everyone), "team" (members
 * of teamId), "user" (only ownerId — personal replies).
 */
export const quickRepliesTable = pgTable("quick_replies", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  categoryId: integer("category_id"),
  /** Typed in the composer as "/shortcut". */
  shortcut: text("shortcut"),
  visibility: text("visibility", { enum: ["all", "team", "user"] }).notNull().default("all"),
  teamId: integer("team_id"),
  ownerId: integer("owner_id"),
  language: text("language"),
  usageCount: integer("usage_count").notNull().default(0),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertQuickReplySchema = createInsertSchema(quickRepliesTable).omit(
  { id: true, createdAt: true },
);
export type InsertQuickReply = z.infer<typeof insertQuickReplySchema>;
export type QuickReply = typeof quickRepliesTable.$inferSelect;
