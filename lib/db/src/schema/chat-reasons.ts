import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { chatReasonCategoriesTable } from "./chat-reason-categories";

export const chatReasonsTable = pgTable("chat_reasons", {
  id: serial("id").primaryKey(),
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  color: text("color").notNull().default("#FCA5A5"),
  categoryId: integer("category_id").references(() => chatReasonCategoriesTable.id, {
    onDelete: "set null",
  }),
  isActive: boolean("is_active").notNull().default(true),
  // Words/phrases (English or Arabic) that put a conversation in this topic
  // automatically. Empty = manual-only topic.
  keywords: text("keywords").array().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ChatReason = typeof chatReasonsTable.$inferSelect;
