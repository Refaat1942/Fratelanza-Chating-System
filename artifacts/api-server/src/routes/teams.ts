/** Teams: CRUD (admins), membership, and the list everyone can read for filters. */
import { Router } from "express";
import { eq, inArray, sql } from "drizzle-orm";
import { db, teamsTable, usersTable } from "@workspace/db";
import { requireAuth, requireAdmin, type AuthRequest } from "../middlewares/auth";
import { logAudit } from "../lib/audit";

const router = Router();

function cleanName(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().slice(0, 60) : "";
  return s || null;
}

router.get("/teams", requireAuth, async (_req, res) => {
  const r = await db.execute(sql`
    SELECT t.id, t.name, t.description, t.color, t.leader_id AS "leaderId", t.is_active AS "isActive", t.created_at AS "createdAt",
           COALESCE(l.display_name, l.name) AS "leaderName",
           COUNT(u.id) FILTER (WHERE u.is_active)::int AS "memberCount",
           COALESCE(json_agg(json_build_object('id', u.id, 'name', COALESCE(u.display_name, u.name), 'role', u.role, 'status', u.status))
             FILTER (WHERE u.id IS NOT NULL AND u.is_active), '[]') AS members,
           (SELECT COUNT(*)::int FROM conversations c WHERE c.team_id = t.id AND c.status <> 'completed') AS "openChats",
           (SELECT COUNT(*)::int FROM conversations c WHERE c.team_id = t.id AND c.status <> 'completed' AND c.assigned_agent_id IS NULL) AS "queued"
    FROM teams t
    LEFT JOIN users l ON l.id = t.leader_id
    LEFT JOIN users u ON u.team_id = t.id
    GROUP BY t.id, l.display_name, l.name
    ORDER BY t.name
  `);
  res.json(r.rows ?? []);
});

async function validLeader(id: unknown): Promise<number | null | "invalid"> {
  if (id === null || id === undefined || id === "") return null;
  const n = Number(id);
  if (!Number.isInteger(n)) return "invalid";
  const [u] = await db.select({ role: usersTable.role, isActive: usersTable.isActive }).from(usersTable).where(eq(usersTable.id, n));
  return u && u.isActive && u.role !== "agent" ? n : "invalid";
}

router.post("/teams", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const name = cleanName(req.body?.name);
  if (!name) { res.status(400).json({ error: "Team name is required" }); return; }
  const leaderId = await validLeader(req.body?.leaderId);
  if (leaderId === "invalid") { res.status(400).json({ error: "The leader must be an active supervisor or admin" }); return; }
  try {
    const [row] = await db.insert(teamsTable).values({
      name,
      description: typeof req.body?.description === "string" ? req.body.description.trim().slice(0, 300) || null : null,
      color: typeof req.body?.color === "string" ? req.body.color.slice(0, 20) : null,
      leaderId,
    }).returning();
    void logAudit({ actorId: req.user?.id, action: "team.created", entityType: "team", entityId: row.id, details: { name } });
    res.status(201).json(row);
  } catch {
    res.status(409).json({ error: "A team with this name already exists" });
  }
});

router.put("/teams/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const updates: Record<string, unknown> = {};
  if (req.body?.name !== undefined) {
    const n = cleanName(req.body.name);
    if (!n) { res.status(400).json({ error: "Team name cannot be empty" }); return; }
    updates.name = n;
  }
  if (req.body?.description !== undefined) updates.description = String(req.body.description ?? "").trim().slice(0, 300) || null;
  if (req.body?.color !== undefined) updates.color = req.body.color ? String(req.body.color).slice(0, 20) : null;
  if (typeof req.body?.isActive === "boolean") updates.isActive = req.body.isActive;
  if (req.body?.leaderId !== undefined) {
    const l = await validLeader(req.body.leaderId);
    if (l === "invalid") { res.status(400).json({ error: "The leader must be an active supervisor or admin" }); return; }
    updates.leaderId = l;
  }
  try {
    const [row] = await db.update(teamsTable).set(updates).where(eq(teamsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    void logAudit({ actorId: req.user?.id, action: "team.updated", entityType: "team", entityId: id, details: { fields: Object.keys(updates) } });
    res.json(row);
  } catch {
    res.status(409).json({ error: "A team with this name already exists" });
  }
});

// Replace the member list in one go.
router.put("/teams/:id/members", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const ids = req.body?.userIds;
  if (!Array.isArray(ids) || !ids.every((x) => Number.isInteger(x))) { res.status(400).json({ error: "userIds must be a list of user ids" }); return; }
  const [team] = await db.select({ id: teamsTable.id }).from(teamsTable).where(eq(teamsTable.id, id));
  if (!team) { res.status(404).json({ error: "Not found" }); return; }
  await db.transaction(async (tx) => {
    await tx.update(usersTable).set({ teamId: null }).where(eq(usersTable.teamId, id));
    if (ids.length) await tx.update(usersTable).set({ teamId: id }).where(inArray(usersTable.id, ids as number[]));
  });
  void logAudit({ actorId: req.user?.id, action: "team.members_changed", entityType: "team", entityId: id, details: { userIds: ids } });
  res.json({ ok: true });
});

// Deleting a team keeps its chats and people: they simply lose the team.
router.delete("/teams/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  await db.transaction(async (tx) => {
    await tx.update(usersTable).set({ teamId: null }).where(eq(usersTable.teamId, id));
    await tx.execute(sql`UPDATE conversations SET team_id = NULL WHERE team_id = ${id}`);
    await tx.execute(sql`UPDATE chat_reasons SET team_id = NULL WHERE team_id = ${id}`);
    await tx.delete(teamsTable).where(eq(teamsTable.id, id));
  });
  void logAudit({ actorId: req.user?.id, action: "team.deleted", entityType: "team", entityId: id });
  res.status(204).send();
});

export default router;
