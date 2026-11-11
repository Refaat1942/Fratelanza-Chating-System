/**
 * Supervision: Whisper Mode, takeover, live monitoring board, activity log.
 *
 * Whisper isolation is enforced here and in the schema, not in the UI:
 *  - whispers live in their own table (`whisper_messages`), so no customer
 *    path (thread API, WhatsApp send, webhooks, campaigns, exports, AI) can
 *    read them;
 *  - an agent can only read/write whisper threads where they are the agent;
 *  - socket events go only to `user:<agentId>` and `whisper-leads` rooms.
 */
import { Router } from "express";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { db, conversationsTable, messagesTable, usersTable, whisperMessagesTable, auditLogsTable } from "@workspace/db";
import { requireAuth, requireAdmin, type AuthRequest } from "../middlewares/auth";
import { requirePermission } from "../middlewares/permissions";
import { hasPermission } from "../lib/permissions";
import { logAudit } from "../lib/audit";
import { drainQueue, getSettings } from "../lib/assignment";
import type { Server as IOServer } from "socket.io";

const router = Router();
const MAX_WHISPER = 2000;

function ioOf(req: AuthRequest): IOServer | undefined {
  return req.app.get("io") as IOServer | undefined;
}

function convId(req: AuthRequest): number | null {
  const id = Number(req.params["id"]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function loadConv(id: number) {
  const [c] = await db
    .select({
      id: conversationsTable.id,
      assignedAgentId: conversationsTable.assignedAgentId,
      takeoverFromAgentId: conversationsTable.takeoverFromAgentId,
      status: conversationsTable.status,
    })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, id));
  return c ?? null;
}

async function displayName(userId: number): Promise<string> {
  const [u] = await db
    .select({ name: usersTable.name, displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  return u?.displayName || u?.name || "Someone";
}

/** The agent a supervisor's whisper goes to: the assignee, or — during a takeover — the agent they took over from. */
function whisperTarget(c: { assignedAgentId: number | null; takeoverFromAgentId: number | null }, supervisorId: number): number | null {
  if (c.assignedAgentId !== null && c.assignedAgentId !== supervisorId) return c.assignedAgentId;
  return c.takeoverFromAgentId ?? null;
}

const whisperCols = {
  id: whisperMessagesTable.id,
  conversationId: whisperMessagesTable.conversationId,
  agentId: whisperMessagesTable.agentId,
  senderId: whisperMessagesTable.senderId,
  body: whisperMessagesTable.body,
  readAt: whisperMessagesTable.readAt,
  createdAt: whisperMessagesTable.createdAt,
  senderName: sql<string>`COALESCE(${usersTable.displayName}, ${usersTable.name})`,
  senderRole: usersTable.role,
};

// ── Whisper ─────────────────────────────────────────────────────────────────

router.get("/conversations/:id/whispers", requireAuth, async (req: AuthRequest, res) => {
  const id = convId(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const me = req.user!;
  const lead = await hasPermission(me.id, me.role, "canWhisper");
  const where = lead
    ? eq(whisperMessagesTable.conversationId, id)
    : and(eq(whisperMessagesTable.conversationId, id), eq(whisperMessagesTable.agentId, me.id));
  const rows = await db
    .select(whisperCols)
    .from(whisperMessagesTable)
    .leftJoin(usersTable, eq(usersTable.id, whisperMessagesTable.senderId))
    .where(where)
    .orderBy(whisperMessagesTable.id)
    .limit(1000);
  res.set("Cache-Control", "no-store");
  res.json(rows);
});

router.post("/conversations/:id/whispers", requireAuth, async (req: AuthRequest, res) => {
  const id = convId(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!body) { res.status(400).json({ error: "body required" }); return; }
  if (body.length > MAX_WHISPER) { res.status(400).json({ error: `Whisper is limited to ${MAX_WHISPER} characters` }); return; }

  const me = req.user!;
  const c = await loadConv(id);
  if (!c) { res.status(404).json({ error: "Not found" }); return; }

  let agentId: number | null;
  const lead = await hasPermission(me.id, me.role, "canWhisper");
  if (lead && c.assignedAgentId !== me.id) {
    agentId = whisperTarget(c, me.id);
    if (agentId === null) { res.status(400).json({ error: "No agent is handling this chat yet — assign it first" }); return; }
  } else if (lead && c.takeoverFromAgentId !== null) {
    // A supervisor who took the chat over can still brief the original agent.
    agentId = c.takeoverFromAgentId;
  } else {
    // Agents: only in chats they handle (or handled before a takeover), and
    // only on their own thread with the supervisors.
    if (c.assignedAgentId !== me.id && c.takeoverFromAgentId !== me.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    agentId = me.id;
  }

  const [row] = await db
    .insert(whisperMessagesTable)
    .values({ conversationId: id, agentId, senderId: me.id, body })
    .returning();
  const out = { ...row, senderName: await displayName(me.id), senderRole: me.role };

  const io = ioOf(req);
  io?.to(`user:${agentId}`).to("whisper-leads").emit("whisper", out);
  void logAudit({
    actorId: me.id,
    action: "whisper.sent",
    entityType: "conversation",
    entityId: id,
    details: { whisperId: row.id, agentId, direction: me.id === agentId ? "agent_to_supervisor" : "supervisor_to_agent" },
  });
  res.status(201).json(out);
});

// Mark whispers addressed to me in this chat as read.
router.post("/conversations/:id/whispers/read", requireAuth, async (req: AuthRequest, res) => {
  const id = convId(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const me = req.user!;
  const lead = await hasPermission(me.id, me.role, "canWhisper");
  // Agent: supervisor messages on my thread. Supervisor: agent replies.
  const cond = lead
    ? sql`conversation_id = ${id} AND sender_id = agent_id AND agent_id <> ${me.id} AND read_at IS NULL`
    : sql`conversation_id = ${id} AND agent_id = ${me.id} AND sender_id <> ${me.id} AND read_at IS NULL`;
  await db.execute(sql`UPDATE whisper_messages SET read_at = NOW() WHERE ${cond}`);
  res.json({ ok: true });
});

// Unread whisper counts per chat for the caller (badges + notifications).
router.get("/whispers/unread", requireAuth, async (req: AuthRequest, res) => {
  const me = req.user!;
  const lead = await hasPermission(me.id, me.role, "canWhisper");
  const cond = lead
    ? sql`sender_id = agent_id AND agent_id <> ${me.id} AND read_at IS NULL AND created_at > NOW() - INTERVAL '7 days'`
    : sql`agent_id = ${me.id} AND sender_id <> ${me.id} AND read_at IS NULL`;
  const r = await db.execute(sql`SELECT conversation_id, COUNT(*)::int AS n FROM whisper_messages WHERE ${cond} GROUP BY conversation_id`);
  const rows = (r.rows ?? []) as { conversation_id: number; n: number }[];
  res.set("Cache-Control", "no-store");
  res.json({
    total: rows.reduce((a, b) => a + b.n, 0),
    byConversation: Object.fromEntries(rows.map((x) => [x.conversation_id, x.n])),
  });
});

// ── Takeover ────────────────────────────────────────────────────────────────

async function systemNote(conversationId: number, actorId: number, body: string) {
  // An internal note (never sent to the customer, never changes "last message").
  const [m] = await db
    .insert(messagesTable)
    .values({ conversationId, senderId: actorId, senderType: "system", body, isNote: true, status: "sent" })
    .returning();
  return m;
}

router.post("/conversations/:id/takeover", requireAuth, requirePermission("canTakeover"), async (req: AuthRequest, res) => {
  const id = convId(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const me = req.user!;
  const c = await loadConv(id);
  if (!c) { res.status(404).json({ error: "Not found" }); return; }
  if (c.assignedAgentId === me.id) { res.status(409).json({ error: "You are already handling this chat" }); return; }
  if (c.takeoverFromAgentId !== null) { res.status(409).json({ error: "Another supervisor has already taken this chat over" }); return; }

  const from = c.assignedAgentId;
  await db
    .update(conversationsTable)
    .set({
      assignedAgentId: me.id,
      takeoverFromAgentId: from,
      takeoverAt: new Date(),
      queuedAt: null,
      ...(c.status === "completed" ? { status: "open" as const, resolvedAt: null } : {}),
    })
    .where(eq(conversationsTable.id, id));

  const who = await displayName(me.id);
  const note = await systemNote(id, me.id, from ? `${who} took over this chat from ${await displayName(from)}.` : `${who} took over this chat.`);
  void logAudit({ actorId: me.id, action: "conversation.takeover", entityType: "conversation", entityId: id, details: { from } });

  const io = ioOf(req);
  io?.to(`conv:${id}`).emit("new_message", note);
  io?.to(`conv:${id}`).emit("agent_assigned", { conversationId: id, agentId: me.id });
  if (from) io?.to(`user:${from}`).emit("takeover", { conversationId: id, by: me.id, byName: who });
  io?.emit("conversation_updated", { conversationId: id });
  res.json({ ok: true, conversationId: id, takeoverFromAgentId: from });
});

router.post("/conversations/:id/release", requireAuth, async (req: AuthRequest, res) => {
  const id = convId(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const me = req.user!;
  const c = await loadConv(id);
  if (!c) { res.status(404).json({ error: "Not found" }); return; }
  const isHolder = c.assignedAgentId === me.id;
  if (!isHolder && me.role !== "admin") { res.status(403).json({ error: "Only the supervisor who took over (or an admin) can hand it back" }); return; }
  if (c.takeoverFromAgentId === null && !(isHolder && me.role !== "agent")) {
    res.status(409).json({ error: "This chat is not under a takeover" });
    return;
  }

  // Back to the original agent if they can still work; otherwise to the queue.
  let to: number | null = c.takeoverFromAgentId;
  if (to !== null) {
    const [u] = await db.select({ isActive: usersTable.isActive }).from(usersTable).where(eq(usersTable.id, to));
    if (!u?.isActive) to = null;
  }
  await db
    .update(conversationsTable)
    .set({ assignedAgentId: to, takeoverFromAgentId: null, takeoverAt: null, ...(to === null ? { queuedAt: new Date() } : {}) })
    .where(eq(conversationsTable.id, id));

  const who = await displayName(me.id);
  const note = await systemNote(id, me.id, to ? `${who} handed the chat back to ${await displayName(to)}.` : `${who} returned the chat to the queue.`);
  void logAudit({ actorId: me.id, action: "conversation.takeover_released", entityType: "conversation", entityId: id, details: { to } });

  const io = ioOf(req);
  io?.to(`conv:${id}`).emit("new_message", note);
  io?.to(`conv:${id}`).emit("agent_assigned", { conversationId: id, agentId: to });
  if (to) io?.to(`user:${to}`).emit("takeover_released", { conversationId: id, byName: who });
  io?.emit("conversation_updated", { conversationId: id });
  if (to === null) void drainQueue(io);
  res.json({ ok: true, conversationId: id, assignedAgentId: to });
});

// ── Live monitoring board ───────────────────────────────────────────────────

const VIEWS = ["active", "hanging", "last_client", "unassigned", "long_waiting", "sla"] as const;
type View = (typeof VIEWS)[number];

router.get("/monitoring", requireAuth, requirePermission("canMonitorChats"), async (req: AuthRequest, res) => {
  const view = (VIEWS as readonly string[]).includes(String(req.query["view"])) ? (req.query["view"] as View) : "active";
  const agentId = Number(req.query["agentId"]);
  const channel = typeof req.query["channel"] === "string" ? req.query["channel"] : "";
  const teamId = Number(req.query["teamId"]);
  const s = await getSettings();
  const sla = Math.max(1, s.slaMinutes ?? 15);
  const hanging = Math.max(1, (s as { hangingHours?: number }).hangingHours ?? 24);

  const notDone = sql`c.status <> 'completed'`;
  const waitingExpr = sql`CASE WHEN c.last_sender_type = 'customer' THEN EXTRACT(EPOCH FROM (NOW() - c.last_message_at)) / 60 END`;
  const viewCond: Record<View, ReturnType<typeof sql>> = {
    active: sql`c.status IN ('open','pending') AND c.assigned_agent_id IS NOT NULL`,
    hanging: sql`${notDone} AND COALESCE(c.last_message_at, c.created_at) < NOW() - make_interval(hours => ${hanging})`,
    last_client: sql`${notDone} AND c.last_sender_type = 'customer'`,
    unassigned: sql`${notDone} AND c.assigned_agent_id IS NULL`,
    long_waiting: sql`${notDone} AND c.assigned_agent_id IS NULL AND COALESCE(c.queued_at, c.created_at) < NOW() - make_interval(mins => ${sla})`,
    sla: sql`${notDone} AND c.last_sender_type = 'customer' AND c.last_message_at < NOW() - make_interval(secs => ${sla * 30})`,
  };

  const filters = [viewCond[view]];
  if (Number.isInteger(agentId) && agentId > 0) filters.push(sql`c.assigned_agent_id = ${agentId}`);
  if (channel) filters.push(sql`c.channel = ${channel}`);
  // Team: chats routed to the team, or handled by one of its members.
  if (Number.isInteger(teamId) && teamId > 0) filters.push(sql`(c.team_id = ${teamId} OR u.team_id = ${teamId})`);
  const where = sql.join(filters, sql` AND `);
  const order =
    view === "active" ? sql`c.last_message_at DESC NULLS LAST`
    : view === "unassigned" || view === "long_waiting" ? sql`COALESCE(c.queued_at, c.created_at) ASC`
    : sql`COALESCE(c.last_message_at, c.created_at) ASC`;

  const list = await db.execute(sql`
    SELECT c.id, c.status, c.channel, c.created_at, c.last_message_at, c.last_sender_type,
           LEFT(c.last_message, 140) AS last_message, c.unread_count, c.queued_at,
           c.assigned_agent_id, COALESCE(u.display_name, u.name) AS agent_name, u.status AS agent_status,
           c.takeover_from_agent_id, COALESCE(tu.display_name, tu.name) AS takeover_from_name, c.takeover_at,
           c.team_id, t.name AS team_name,
           cu.id AS customer_id, cu.name AS customer_name, cu.phone AS customer_phone,
           ${waitingExpr}::int AS waiting_minutes,
           (EXTRACT(EPOCH FROM (NOW() - c.created_at)) / 60)::int AS age_minutes
    FROM conversations c
    JOIN customers cu ON cu.id = c.customer_id
    LEFT JOIN users u ON u.id = c.assigned_agent_id
    LEFT JOIN users tu ON tu.id = c.takeover_from_agent_id
    LEFT JOIN teams t ON t.id = c.team_id
    WHERE ${where}
    ORDER BY ${order}
    LIMIT 500
  `);

  const counts = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE ${viewCond.active})::int AS active,
      COUNT(*) FILTER (WHERE ${viewCond.hanging})::int AS hanging,
      COUNT(*) FILTER (WHERE ${viewCond.last_client})::int AS last_client,
      COUNT(*) FILTER (WHERE ${viewCond.unassigned})::int AS unassigned,
      COUNT(*) FILTER (WHERE ${viewCond.long_waiting})::int AS long_waiting,
      COUNT(*) FILTER (WHERE ${viewCond.sla})::int AS sla
    FROM conversations c
    LEFT JOIN users u ON u.id = c.assigned_agent_id
    ${Number.isInteger(teamId) && teamId > 0 ? sql`WHERE (c.team_id = ${teamId} OR u.team_id = ${teamId})` : sql``}
  `);

  const agents = await db.execute(sql`
    SELECT u.id, COALESCE(u.display_name, u.name) AS name, u.role, u.status, u.last_login_at, u.team_id,
           COUNT(c.id) FILTER (WHERE c.status IN ('open','pending'))::int AS open_chats,
           COUNT(c.id) FILTER (WHERE c.status <> 'completed' AND c.last_sender_type = 'customer')::int AS awaiting_reply
    FROM users u
    LEFT JOIN conversations c ON c.assigned_agent_id = u.id
    WHERE u.is_active AND u.role IN ('agent','supervisor')
      ${Number.isInteger(teamId) && teamId > 0 ? sql`AND u.team_id = ${teamId}` : sql``}
    GROUP BY u.id
    ORDER BY u.status = 'available' DESC, open_chats DESC, name
  `);

  res.set("Cache-Control", "no-store");
  res.json({
    view,
    thresholds: { slaMinutes: sla, hangingHours: hanging },
    counts: (counts.rows ?? [])[0] ?? {},
    agents: agents.rows ?? [],
    conversations: (list.rows ?? []).map((r) => {
      const w = (r as { waiting_minutes: number | null }).waiting_minutes;
      return { ...r, sla_breached: w !== null && w >= sla };
    }),
  });
});

// ── Activity log ────────────────────────────────────────────────────────────

router.get("/audit-logs", requireAuth, requireAdmin, async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query["limit"]) || 100));
  const before = Number(req.query["before"]);
  const actorId = Number(req.query["actorId"]);
  const entityId = Number(req.query["entityId"]);
  const action = typeof req.query["action"] === "string" ? req.query["action"].trim() : "";
  const entityType = typeof req.query["entityType"] === "string" ? req.query["entityType"].trim() : "";

  const conds = [];
  if (Number.isInteger(before) && before > 0) conds.push(lt(auditLogsTable.id, before));
  if (Number.isInteger(actorId) && actorId > 0) conds.push(eq(auditLogsTable.actorId, actorId));
  if (Number.isInteger(entityId) && entityId > 0) conds.push(eq(auditLogsTable.entityId, entityId));
  if (entityType) conds.push(eq(auditLogsTable.entityType, entityType));
  // "whisper" matches all whisper.* actions; a full key matches exactly.
  if (action) conds.push(action.includes(".") ? eq(auditLogsTable.action, action) : sql`${auditLogsTable.action} LIKE ${action + ".%"}`);

  const rows = await db
    .select({
      id: auditLogsTable.id,
      actorId: auditLogsTable.actorId,
      actorName: sql<string | null>`COALESCE(${usersTable.displayName}, ${usersTable.name})`,
      action: auditLogsTable.action,
      entityType: auditLogsTable.entityType,
      entityId: auditLogsTable.entityId,
      details: auditLogsTable.details,
      createdAt: auditLogsTable.createdAt,
    })
    .from(auditLogsTable)
    .leftJoin(usersTable, eq(usersTable.id, auditLogsTable.actorId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditLogsTable.id))
    .limit(limit);
  res.set("Cache-Control", "no-store");
  res.json({ rows, nextBefore: rows.length === limit ? rows[rows.length - 1]!.id : null });
});

export default router;
