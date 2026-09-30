import { pgTable, serial, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role", { enum: ["admin", "agent"] }).notNull().default("agent"),
  passwordHash: text("password_hash").notNull(),
  // Shown in the UI instead of the email (falls back to `name`).
  displayName: text("display_name"),
  // Deactivated users cannot log in; their history is kept.
  isActive: boolean("is_active").notNull().default(true),
  // Set when an admin issues a temporary password: user must choose a new one.
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  status: text("status", { enum: ["available", "busy", "offline"] })
    .notNull()
    .default("available"),
  lastAssignedAt: timestamp("last_assigned_at"),
  notReadyReasonId: integer("not_ready_reason_id"),
  notReadySince: timestamp("not_ready_since"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
