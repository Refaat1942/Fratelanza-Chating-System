import { pgTable, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * Single-row configuration table (id always = 1).
 * Holds chat-distribution + branding settings.
 */
export const settingsTable = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  maxChatsPerAgent: integer("max_chats_per_agent").notNull().default(5),
  autoAssign: boolean("auto_assign").notNull().default(true),
  assignmentStrategy: text("assignment_strategy", {
    enum: ["round_robin", "least_busy"],
  })
    .notNull()
    .default("least_busy"),
  // Branding — admin-configurable
  companyName: text("company_name").notNull().default("Fratelanza"),
  logoUrl: text("logo_url"),
  // Brand colours (hex, e.g. "#0a7d5a"). NULL = built-in default theme.
  primaryColor: text("primary_color"),
  accentColor: text("accent_color"),
  // SLA threshold (in minutes) used for chat-monitoring "Late" status
  slaMinutes: integer("sla_minutes").notNull().default(15),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Settings = typeof settingsTable.$inferSelect;
