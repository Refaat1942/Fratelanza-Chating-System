import { pgTable, serial, integer, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

/**
 * Append-only activity log: assignments, takeovers, whispers, supervisor
 * monitoring, user / role / permission changes, logins. Never updated or
 * deleted by the application.
 */
export const auditLogsTable = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    actorId: integer("actor_id"),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: integer("entity_id"),
    details: jsonb("details"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt), index("audit_entity_idx").on(t.entityType, t.entityId)],
);

export type AuditLog = typeof auditLogsTable.$inferSelect;
