import { db, auditLogsTable } from "@workspace/db";
import { logger } from "./logger";

export interface AuditEntry {
  actorId: number | null | undefined;
  action: string;
  entityType?: string;
  entityId?: number | null;
  details?: Record<string, unknown>;
}

/** Append one activity-log row. Never throws: auditing must not break the action. */
export async function logAudit(e: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      actorId: e.actorId ?? null,
      action: e.action,
      entityType: e.entityType ?? null,
      entityId: e.entityId ?? null,
      details: e.details ?? null,
    });
  } catch (err) {
    logger.warn({ err, action: e.action }, "audit log write failed");
  }
}

// "Supervisor opened chat X" is logged at most once per 10 minutes per pair,
// so a supervisor keeping a chat open doesn't flood the log.
const recentMonitor = new Map<string, number>();
export function logMonitorOpen(actorId: number, conversationId: number, agentId: number | null): void {
  const key = `${actorId}:${conversationId}`;
  const now = Date.now();
  if ((recentMonitor.get(key) ?? 0) > now - 10 * 60_000) return;
  recentMonitor.set(key, now);
  if (recentMonitor.size > 5000) recentMonitor.clear();
  void logAudit({ actorId, action: "monitor.open", entityType: "conversation", entityId: conversationId, details: { agentId } });
}
