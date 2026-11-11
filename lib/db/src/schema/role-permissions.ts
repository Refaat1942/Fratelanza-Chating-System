import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * Per-role permission flags.
 *
 * Five fixed booleans (option "a" — simple). Two seed rows:
 *   admin → everything true
 *   agent → reasonable defaults
 *
 * The frontend reads these to gate UI; the API still enforces admin-only
 * routes via requireAdmin middleware regardless of these flags.
 */
export const rolePermissionsTable = pgTable("role_permissions", {
  role: text("role", { enum: ["admin", "supervisor", "agent"] }).primaryKey(),
  canViewChats: boolean("can_view_chats").notNull().default(true),
  canSendMessages: boolean("can_send_messages").notNull().default(true),
  canViewReports: boolean("can_view_reports").notNull().default(false),
  canManageCustomers: boolean("can_manage_customers").notNull().default(true),
  canManageSettings: boolean("can_manage_settings").notNull().default(false),
  // Supervision: open other people's live chats, whisper to the agent, take over.
  canMonitorChats: boolean("can_monitor_chats").notNull().default(false),
  canWhisper: boolean("can_whisper").notNull().default(false),
  canTakeover: boolean("can_takeover").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type RolePermissions = typeof rolePermissionsTable.$inferSelect;
