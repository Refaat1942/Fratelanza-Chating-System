import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

/** Admin-defined extra customer fields; values live in customers.custom_fields. */
export const customerFieldsTable = pgTable("customer_fields", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  label: text("label").notNull(),
  type: text("type", { enum: ["text", "number", "date", "select"] }).notNull().default("text"),
  options: text("options").array().notNull().default([]),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type CustomerField = typeof customerFieldsTable.$inferSelect;
