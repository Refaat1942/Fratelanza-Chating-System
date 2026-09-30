import { Router } from "express";
import { db } from "@workspace/db";
import { conversationsTable, customersTable, usersTable } from "@workspace/db";
import { eq, and, or, isNull, ilike, desc, sql } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { requirePermission } from "../middlewares/permissions";
import { tryAutoAssign, drainQueue } from "../lib/assignment";
import type { Server as IOServer } from "socket.io";

const router = Router();

async function getConversationWithRelations(id: number) {
  const rows = await db.select({
    id: conversationsTable.id,
    customerId: conversationsTable.customerId,
    assignedAgentId: conversationsTable.assignedAgentId,
    status: conversationsTable.status,
    channel: conversationsTable.channel,
    tags: conversationsTable.tags,
    chatReasonId: conversationsTable.chatReasonId,
    lastMessage: conversationsTable.lastMessage,
    lastMessageAt: conversationsTable.lastMessageAt,
    lastSenderType: conversationsTable.lastSenderType,
    unreadCount: conversationsTable.unreadCount,
    createdAt: conversationsTable.createdAt,
    resolvedAt: conversationsTable.resolvedAt,
    queuedAt: conversationsTable.queuedAt,
    customer: {
      id: customersTable.id,
      name: customersTable.name,
      phone: customersTable.phone,
      branch: customersTable.branch,
      tags: customersTable.tags,
      notes: customersTable.notes,
      prescriptionNotes: customersTable.prescriptionNotes,
      createdAt: customersTable.createdAt,
    },
    assignedAgent: {
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      status: usersTable.status,
      createdAt: usersTable.createdAt,
    },
  }).from(conversationsTable)
    .leftJoin(customersTable, eq(conversationsTable.customerId, customersTable.id))
    .leftJoin(usersTable, eq(conversationsTable.assignedAgentId, usersTable.id))
    .where(eq(conversationsTable.id, id));
  return rows[0] ?? null;
}

router.get("/conversations", requireAuth, requirePermission("canViewChats"), async (req: AuthRequest, res) => {
  const { status, agentId, tag, search } = req.query as Record<string, string>;

  const baseQuery = db.select({
    id: conversationsTable.id,
    customerId: conversationsTable.customerId,
    assignedAgentId: conversationsTable.assignedAgentId,
    status: conversationsTable.status,
    channel: conversationsTable.channel,
    tags: conversationsTable.tags,
    chatReasonId: conversationsTable.chatReasonId,
    lastMessage: conversationsTable.lastMessage,
    lastMessageAt: conversationsTable.lastMessageAt,
    lastSenderType: conversationsTable.lastSenderType,
    unreadCount: conversationsTable.unreadCount,
    createdAt: conversationsTable.createdAt,
    resolvedAt: conversationsTable.resolvedAt,
    queuedAt: conversationsTable.queuedAt,
    customer: {
      id: customersTable.id,
      name: customersTable.name,
      phone: customersTable.phone,
      branch: customersTable.branch,
      tags: customersTable.tags,
      notes: customersTable.notes,
      prescriptionNotes: customersTable.prescriptionNotes,
      createdAt: customersTable.createdAt,
    },
    assignedAgent: {
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      status: usersTable.status,
      createdAt: usersTable.createdAt,
    },
  }).from(conversationsTable)
    .leftJoin(customersTable, eq(conversationsTable.customerId, customersTable.id))
    .leftJoin(usersTable, eq(conversationsTable.assignedAgentId, usersTable.id));

  const conditions = [];
  if (status) conditions.push(eq(conversationsTable.status, status as "open" | "completed" | "pending"));
  if (agentId) conditions.push(eq(conversationsTable.assignedAgentId, Number(agentId)));
  if (search) conditions.push(ilike(customersTable.name, `%${search}%`));
  if (tag) conditions.push(sql<boolean>`${tag} = ANY(${conversationsTable.tags})`);
  if (req.user?.role === "agent") {
    // Own chats + the unassigned queue (agents must be able to see a queued
    // chat in order to claim it).
    conditions.push(
      or(eq(conversationsTable.assignedAgentId, req.user.id), isNull(conversationsTable.assignedAgentId))!,
    );
  }

  const rows = await baseQuery
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(conversationsTable.lastMessageAt));

  res.json(rows);
});

// Cheap change-detector for polling: one aggregate row describing the inbox the
// caller can see. The client only re-fetches the full list when `version` moves.
router.get("/inbox/sync", requireAuth, requirePermission("canViewChats"), async (req: AuthRequest, res) => {
  const scope =
    req.user?.role === "agent"
      ? sql`WHERE assigned_agent_id = ${req.user.id} OR assigned_agent_id IS NULL`
      : sql``;
  const result = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      COALESCE(SUM(unread_count), 0)::int AS unread,
      COALESCE(SUM(hashtext(
        id::text || ':' || status || ':' || COALESCE(assigned_agent_id::text, '-') || ':' ||
        unread_count::text || ':' || COALESCE(extract(epoch FROM last_message_at)::text, '-')
      )::bigint), 0)::text AS version
    FROM conversations ${scope}
  `);
  const row = (result.rows ?? result)[0] as { total: number; unread: number; version: string };
  res.set("Cache-Control", "no-store");
  res.json({ total: row.total, unread: row.unread, version: row.version });
});

// Mark a conversation as read (clears the unread badge).
router.post("/conversations/:id/read", requireAuth, requirePermission("canViewChats"), async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const existing = await getConversationWithRelations(id);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (req.user?.role === "agent" && existing.assignedAgentId !== req.user.id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  if (existing.unreadCount > 0) {
    await db.update(conversationsTable).set({ unreadCount: 0 }).where(eq(conversationsTable.id, id));
  }
  res.json({ ok: true });
});

router.post("/conversations", requireAuth, requirePermission("canSendMessages"), async (req, res) => {
  const { customerId, tags, assignedAgentId } = req.body;
  if (!customerId) { res.status(400).json({ error: "customerId required" }); return; }
  const [conv] = await db.insert(conversationsTable).values({
    customerId, tags: tags || [], assignedAgentId: assignedAgentId || null,
  }).returning();

  // If no explicit assignee, run auto-assignment
  if (!assignedAgentId) {
    const io = req.app.get("io") as IOServer | undefined;
    await tryAutoAssign(conv.id, io);
  }

  const full = await getConversationWithRelations(conv.id);
  res.status(201).json(full);
});

router.get("/conversations/:id", requireAuth, requirePermission("canViewChats"), async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const conv = await getConversationWithRelations(id);
  if (!conv) { res.status(404).json({ error: "Not found" }); return; }
  // Agents can view their own chats and unassigned ones (to claim them)
  if (req.user?.role === "agent" && conv.assignedAgentId !== null && conv.assignedAgentId !== req.user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  res.json(conv);
});

router.put("/conversations/:id", requireAuth, requirePermission("canSendMessages"), async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const existing = await getConversationWithRelations(id);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (req.user?.role === "agent" && existing.assignedAgentId !== req.user.id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const { tags, status, assignedAgentId } = req.body;
  const updates: Record<string, unknown> = {};
  if (tags !== undefined) updates.tags = tags;
  if (status !== undefined) updates.status = status;
  // Reassignment is admin-only; agents must use POST /conversations/:id/assign
  // to self-claim. This keeps PUT, PATCH, and /assign on a single policy.
  if (assignedAgentId !== undefined) {
    if (req.user?.role !== "admin") {
      res.status(403).json({ error: "Only admins can reassign conversations" });
      return;
    }
    updates.assignedAgentId = assignedAgentId;
  }
  await db.update(conversationsTable).set(updates).where(eq(conversationsTable.id, id));
  const full = await getConversationWithRelations(id);
  res.json(full);
});

router.patch("/conversations/:id", requireAuth, requirePermission("canSendMessages"), async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const existing = await getConversationWithRelations(id);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  // Agents can only patch conversations explicitly assigned to them.
  // Unassigned conversations require the dedicated /assign endpoint or admin.
  if (req.user?.role === "agent" && existing.assignedAgentId !== req.user.id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const { tags, status, assignedAgentId, chatReasonId } = req.body;
  const updates: Record<string, unknown> = {};
  if (tags !== undefined) updates.tags = tags;
  if (status !== undefined) updates.status = status;
  if (chatReasonId !== undefined) {
    if (chatReasonId === null) {
      updates.chatReasonId = null;
    } else {
      const n = Number(chatReasonId);
      if (!Number.isInteger(n) || n <= 0) {
        res.status(400).json({ error: "chatReasonId must be a positive integer or null" });
        return;
      }
      updates.chatReasonId = n;
    }
  }
  // Only admins may reassign conversations to another agent.
  if (assignedAgentId !== undefined) {
    if (req.user?.role !== "admin") {
      res.status(403).json({ error: "Only admins can reassign conversations" });
      return;
    }
    updates.assignedAgentId = assignedAgentId;
  }
  if (Object.keys(updates).length === 0) { res.json(existing); return; }
  await db.update(conversationsTable).set(updates).where(eq(conversationsTable.id, id));
  const full = await getConversationWithRelations(id);
  res.json(full);
});

router.post("/conversations/:id/assign", requireAuth, requirePermission("canSendMessages"), async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const { agentId } = req.body;
  const existing = await getConversationWithRelations(id);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  // Agents may only self-claim conversations that are currently unassigned.
  // They cannot reassign someone else's conversation or assign to a different
  // agent. Admins may assign any conversation to any agent (or unassign).
  if (req.user?.role === "agent") {
    if (existing.assignedAgentId !== null) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
    if (agentId !== req.user.id) {
      res.status(403).json({ error: "Agents can only claim for themselves" }); return;
    }
  }
  await db.update(conversationsTable).set({ assignedAgentId: agentId || null }).where(eq(conversationsTable.id, id));
  const full = await getConversationWithRelations(id);

  const io = req.app.get("io") as IOServer | undefined;
  if (io) {
    io.to(`conv:${id}`).emit("agent_assigned", { conversationId: id, agentId });
    io.emit("conversation_updated", { conversationId: id });
  }

  res.json(full);
});

router.post("/conversations/:id/resolve", requireAuth, requirePermission("canSendMessages"), async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const existing = await getConversationWithRelations(id);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (req.user?.role === "agent" && existing.assignedAgentId !== req.user.id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  await db.update(conversationsTable).set({ status: "completed", resolvedAt: new Date() }).where(eq(conversationsTable.id, id));
  const full = await getConversationWithRelations(id);

  // The agent now has capacity — try to pull the next queued chat to them.
  const io = req.app.get("io") as IOServer | undefined;
  void drainQueue(io);

  res.json(full);
});

export default router;
