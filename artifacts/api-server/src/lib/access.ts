/**
 * Who may see / act on which conversation. One place for the policy so the
 * HTTP routes and the socket layer can't drift apart.
 *
 *  - admin: everything.
 *  - supervisor: every conversation while they hold "canMonitorChats";
 *    otherwise treated like an agent.
 *  - agent: their own chats + the unassigned queue (read), own chats (write).
 */
import { eq } from "drizzle-orm";
import { db, conversationsTable } from "@workspace/db";
import { hasPermission } from "./permissions";

export interface Actor {
  id: number;
  role: string;
}

export async function seesAllChats(u: Actor): Promise<boolean> {
  if (u.role === "admin") return true;
  if (u.role === "supervisor") return hasPermission(u.id, u.role, "canMonitorChats");
  return false;
}

async function assigneeOf(conversationId: number): Promise<{ found: boolean; agentId: number | null }> {
  const [c] = await db
    .select({ a: conversationsTable.assignedAgentId })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conversationId))
    .limit(1);
  return c ? { found: true, agentId: c.a } : { found: false, agentId: null };
}

/** Read the thread: own, unassigned (to decide to claim it), or any if monitoring. */
export async function canReadConversation(u: Actor, conversationId: number): Promise<boolean> {
  const { found, agentId } = await assigneeOf(conversationId);
  if (!found) return false;
  if (agentId === null || agentId === u.id) return true;
  return seesAllChats(u);
}

/** Write to the customer: admins anywhere (unchanged); everyone else only in chats assigned to them. */
export async function canSendInConversation(u: Actor, conversationId: number): Promise<boolean> {
  const { found, agentId } = await assigneeOf(conversationId);
  if (!found) return false;
  if (u.role === "admin") return true;
  return agentId === u.id;
}
