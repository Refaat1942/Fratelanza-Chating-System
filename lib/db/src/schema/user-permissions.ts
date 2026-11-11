import { pgTable, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Optional per-user permission overrides. Null = inherit from role_permissions.
 */
export const userPermissionsTable = pgTable("user_permissions", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  canViewChats: boolean("can_view_chats"),
  canSendMessages: boolean("can_send_messages"),
  canViewReports: boolean("can_view_reports"),
  canManageCustomers: boolean("can_manage_customers"),
  canManageSettings: boolean("can_manage_settings"),
  canMonitorChats: boolean("can_monitor_chats"),
  canWhisper: boolean("can_whisper"),
  canTakeover: boolean("can_takeover"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type UserPermissions = typeof userPermissionsTable.$inferSelect;
