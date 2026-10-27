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
    chatReasonAuto: conversationsTable.chatReasonAuto,
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
    chatReasonAuto: conversationsTable.chatReasonAuto,
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
        unread_count::text || ':' || COALESCE(extract(epoch FROM last_message_at)::text, '-') || ':' ||
        COALESCE(chat_reason_id::text, '-') || ':' || array_to_string(tags, ',')
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

// Bulk actions on many chats at once (multi-select in the inbox).
// Agents may only change chats assigned to them (or claim unassigned ones).
router.post("/conversations/bulk", requireAuth, requirePermission("canSendMessages"), async (req: AuthRequest, res) => {
  const { ids, action, value } = req.body ?? {};
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500 || !ids.every((i) => Number.isInteger(i) && i > 0)) {
    res.status(400).json({ error: "ids must be 1-500 conversation ids" });
    return;
  }
  const user = req.user!;
  const isAdmin = user.role === "admin";
  const idList = sql.join((ids as number[]).map((i) => sql`${i}`), sql`, `);
  const scope = isAdmin
    ? sql``
    : action === "assignMe"
      ? sql` AND assigned_agent_id IS NULL`
      : sql` AND assigned_agent_id = ${user.id}`;

  let result;
  switch (action) {
    case "topic": {
      if (value !== null && !(Number.isInteger(value) && value > 0)) {
        res.status(400).json({ error: "value must be a topic id or null" });
        return;
      }
      result = await db.execute(sql`UPDATE conversations SET chat_reason_id = ${value}, chat_reason_auto = false WHERE id IN (${idList})${scope}`);
      break;
    }
    case "addTag":
    case "removeTag": {
      const tag = typeof value === "string" ? value.trim().slice(0, 40) : "";
      if (!tag) { res.status(400).json({ error: "value must be a list/tag name" }); return; }
      result = action === "addTag"
        ? await db.execute(sql`UPDATE conversations SET tags = array_append(tags, ${tag}) WHERE id IN (${idList}) AND NOT (${tag} = ANY(tags))${scope}`)
        : await db.execute(sql`UPDATE conversations SET tags = array_remove(tags, ${tag}) WHERE id IN (${idList})${scope}`);
      break;
    }
    case "status": {
      if (!["open", "pending", "completed"].includes(value)) {
        res.status(400).json({ error: "value must be open, pending or completed" });
        return;
      }
      result = value === "completed"
        ? await db.execute(sql`UPDATE conversations SET status = 'completed', resolved_at = NOW() WHERE id IN (${idList})${scope}`)
        : await db.execute(sql`UPDATE conversations SET status = ${value} WHERE id IN (${idList})${scope}`);
      break;
    }
    case "read":
      result = await db.execute(sql`UPDATE conversations SET unread_count = 0 WHERE id IN (${idList})${scope}`);
      break;
    case "assignMe":
      result = await db.execute(sql`UPDATE conversations SET assigned_agent_id = ${user.id}, queued_at = NULL WHERE id IN (${idList})${scope}`);
      break;
    case "assign": {
      // Admin hands chats to a specific person (or back to the queue with null).
      // Limits apply to automatic distribution; an admin may deliberately exceed them.
      if (!isAdmin) { res.status(403).json({ error: "Only admins can assign chats to other people" }); return; }
      if (value === null) {
        result = await db.execute(sql`UPDATE conversations SET assigned_agent_id = NULL, status = CASE WHEN status = 'completed' THEN status ELSE 'pending' END, queued_at = COALESCE(queued_at, NOW()) WHERE id IN (${idList})`);
        break;
      }
      if (!(Number.isInteger(value) && value > 0)) { res.status(400).json({ error: "value must be a user id or null" }); return; }
      const [target] = await db.select({ id: usersTable.id, isActive: usersTable.isActive }).from(usersTable).where(eq(usersTable.id, value));
      if (!target || !target.isActive) { res.status(400).json({ error: "That user does not exist or is deactivated" }); return; }
      result = await db.execute(sql`UPDATE conversations SET assigned_agent_id = ${value}, queued_at = NULL, status = CASE WHEN status = 'pending' AND assigned_agent_id IS NULL THEN 'open' ELSE status END WHERE id IN (${idList})`);
      break;
    }
    default:
      res.status(400).json({ error: "Unknown action" });
      return;
  }
  const updated = Number((result as { rowCount?: number | null }).rowCount ?? 0);
  const io = req.app.get("io") as IOServer | undefined;
  io?.emit("conversation_updated", { conversationId: 0 });
  if (action === "status" && value === "completed") void drainQueue(io);
  res.json({ updated, skipped: ids.length - updated });
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
      updates.chatReasonAuto = false;
    } else {
      const n = Number(chatReasonId);
      if (!Number.isInteger(n) || n <= 0) {
        res.status(400).json({ error: "chatReasonId must be a positive integer or null" });
        return;
      }
      updates.chatReasonId = n;
      updates.chatReasonAuto = false; // chosen by a person: automation keeps its hands off
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
