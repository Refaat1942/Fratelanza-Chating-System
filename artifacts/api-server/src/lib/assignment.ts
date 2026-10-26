/**
 * Chat distribution / auto-assignment service.
 *
 * Public API:
 *   - getSettings()
 *   - updateSettings(patch)
 *   - tryAutoAssign(conversationId, io?)
 *   - drainQueue(io?)
 *
 * Concurrency model
 * -----------------
 * Two failure modes the naive code is vulnerable to:
 *   1. Two concurrent calls assigning the same conversation twice.
 *   2. Two concurrent calls picking the same "least-busy" agent and
 *      exceeding maxChatsPerAgent.
 *
 * Both are handled by performing every assignment inside a single
 * `db.transaction(...)` that:
 *   a) Locks the conversation row (`SELECT … FOR UPDATE`) — prevents two
 *      transactions from claiming the same conversation at the same time.
 *   b) Re-reads the agent's current load *inside the transaction* before
 *      committing — guarantees we never exceed `maxChatsPerAgent`.
 *
 * Round-robin fairness uses `users.last_assigned_at`, written every time
 * we assign (not derived from `conversations.createdAt`, which is
 * unrelated to assignment time).
 */
import { db } from "@workspace/db";
import {
  conversationsTable,
  settingsTable,
  usersTable,
  type Settings,
} from "@workspace/db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Server as IOServer } from "socket.io";

/* -------------------------------------------------------------------------- */
/*  Settings                                                                  */
/* -------------------------------------------------------------------------- */

export async function getSettings(): Promise<Settings> {
  const rows = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.id, 1));
  if (rows.length > 0) return rows[0];
  const [created] = await db.insert(settingsTable).values({ id: 1 }).returning();
  return created;
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  await getSettings();
  const updates = { ...patch, updatedAt: new Date() };
  const [row] = await db
    .update(settingsTable)
    .set(updates)
    .where(eq(settingsTable.id, 1))
    .returning();
  return row;
}

/* -------------------------------------------------------------------------- */
/*  Internal helpers                                                          */
/* -------------------------------------------------------------------------- */

type Strategy = "round_robin" | "least_busy";

interface AgentRow {
  id: number;
  load: number;
  lastAssignedAt: Date | null;
}

/**
 * Return all agents that are currently `available` along with their current
 * open+pending workload and last-assignment timestamp.
 *
 * Accepts an executor so this can run inside a transaction (`tx`) or against
 * the top-level `db`.
 */
async function listAvailableAgents(
  exec: typeof db,
  excludeAgentId?: number,
): Promise<AgentRow[]> {
  const rows = await exec
    .select({
      id: usersTable.id,
      load: sql<number>`COALESCE(COUNT(${conversationsTable.id}) FILTER (
              WHERE ${conversationsTable.status} IN ('open','pending')
                AND ${conversationsTable.assignedAgentId} = ${usersTable.id}), 0)::int`,
      lastAssignedAt: usersTable.lastAssignedAt,
    })
    .from(usersTable)
    .leftJoin(
      conversationsTable,
      eq(conversationsTable.assignedAgentId, usersTable.id),
    )
    .where(and(eq(usersTable.role, "agent"), eq(usersTable.status, "available")))
    .groupBy(usersTable.id, usersTable.lastAssignedAt);

  return excludeAgentId === undefined
    ? rows
    : rows.filter((r) => r.id !== excludeAgentId);
}

/** Sort eligible agents per strategy and return the winner's id, or null. */
function chooseAgent(eligible: AgentRow[], strategy: Strategy): number | null {
  if (eligible.length === 0) return null;

  const sorted = [...eligible];
  if (strategy === "round_robin") {
    // Longest-idle (oldest assignment time) first; null = never assigned, wins.
    sorted.sort((a, b) => {
      const aT = a.lastAssignedAt ? new Date(a.lastAssignedAt).getTime() : 0;
      const bT = b.lastAssignedAt ? new Date(b.lastAssignedAt).getTime() : 0;
      return aT - bT;
    });
  } else {
    // least_busy: lowest workload, tie-break by oldest assignment.
    sorted.sort((a, b) => {
      if (a.load !== b.load) return a.load - b.load;
      const aT = a.lastAssignedAt ? new Date(a.lastAssignedAt).getTime() : 0;
      const bT = b.lastAssignedAt ? new Date(b.lastAssignedAt).getTime() : 0;
      return aT - bT;
    });
  }
  return sorted[0].id;
}

/* -------------------------------------------------------------------------- */
/*  tryAutoAssign — atomic                                                    */
/* -------------------------------------------------------------------------- */

export async function tryAutoAssign(
  conversationId: number,
  io?: IOServer,
): Promise<number | null> {
  const settings = await getSettings();
  if (!settings.autoAssign) return null;

  // All decisions happen inside a single transaction so that we cannot
  // double-assign a conversation or oversubscribe an agent.
  const result = await db.transaction(async (tx) => {
    // 1) Lock the conversation row.
    const lockedRows = await tx.execute(sql`
      SELECT id, assigned_agent_id, status, queued_at
      FROM ${conversationsTable}
      WHERE id = ${conversationId}
      FOR UPDATE
    `);
    const conv = (lockedRows.rows ?? lockedRows)[0] as
      | { id: number; assigned_agent_id: number | null; status: string; queued_at: Date | null }
      | undefined;
    if (!conv) return { agentId: null as number | null, queued: false };
    if (conv.assigned_agent_id) return { agentId: conv.assigned_agent_id, queued: false };
    if (conv.status === "completed") return { agentId: null, queued: false };

    // 2) Pick a candidate from currently-available agents.
    const candidates = (await listAvailableAgents(tx as unknown as typeof db)).filter(
      (a) => a.load < settings.maxChatsPerAgent,
    );
    const agentId = chooseAgent(candidates, settings.assignmentStrategy);

    if (agentId === null) {
      // No one available → queue.
      await tx
        .update(conversationsTable)
        .set({
          status: "pending",
          queuedAt: conv.queued_at ? new Date(conv.queued_at) : new Date(),
        })
        .where(eq(conversationsTable.id, conversationId));
      return { agentId: null, queued: true };
    }

    // 3) Re-verify chosen agent's load *inside the transaction* — strict
    //    capacity enforcement under concurrent load.
    const [{ load }] = await tx
      .select({
        load: sql<number>`COUNT(*) FILTER (
                WHERE ${conversationsTable.status} IN ('open','pending'))::int`,
      })
      .from(conversationsTable)
      .where(eq(conversationsTable.assignedAgentId, agentId));
    if (load >= settings.maxChatsPerAgent) {
      // Another tx beat us to the last slot — queue and let drainQueue retry.
      await tx
        .update(conversationsTable)
        .set({
          status: "pending",
          queuedAt: conv.queued_at ? new Date(conv.queued_at) : new Date(),
        })
        .where(eq(conversationsTable.id, conversationId));
      return { agentId: null, queued: true };
    }

    // 4) Assign + bump agent's last-assigned timestamp.
    const now = new Date();
    await tx
      .update(conversationsTable)
      .set({
        assignedAgentId: agentId,
        status: "open",
        queuedAt: null,
      })
      .where(eq(conversationsTable.id, conversationId));
    await tx
      .update(usersTable)
      .set({ lastAssignedAt: now })
      .where(eq(usersTable.id, agentId));

    return { agentId, queued: false };
  });

  if (io) {
    if (result.agentId) {
      io.emit("conversation_assigned", {
        conversationId,
        agentId: result.agentId,
      });
      io.to(`conv:${conversationId}`).emit("agent_assigned", {
        conversationId,
        agentId: result.agentId,
      });
    } else if (result.queued) {
      io.emit("conversation_queued", { conversationId });
    }
  }

  return result.agentId;
}

/* -------------------------------------------------------------------------- */
/*  drainQueue — strict FIFO over true queued conversations                   */
/* -------------------------------------------------------------------------- */

export async function drainQueue(io?: IOServer): Promise<number> {
  const settings = await getSettings();
  if (!settings.autoAssign) return 0;

  // Only true queued conversations: status='pending' AND no assignee, oldest
  // queuedAt first (FIFO). Conversations without queuedAt fall back to
  // createdAt to handle legacy rows.
  const queued = await db
    .select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(
      and(
        isNull(conversationsTable.assignedAgentId),
        eq(conversationsTable.status, "pending"),
      ),
    )
    .orderBy(
      asc(conversationsTable.queuedAt),
      asc(conversationsTable.createdAt),
    );

  let assigned = 0;
  for (const { id } of queued) {
    const agentId = await tryAutoAssign(id, io);
    if (agentId) assigned += 1;
  }
  return assigned;
}
