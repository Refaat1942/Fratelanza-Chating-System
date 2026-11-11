/**
 * Speed messages (quick replies): categories, team / personal visibility,
 * "/shortcut" codes, variables and usage counts.
 *
 * Who can manage what:
 *  - admins: everything;
 *  - supervisors: replies for everyone or for a team;
 *  - agents: their own personal replies only.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { quickRepliesTable, quickReplyCategoriesTable } from "@workspace/db";
import { asc, eq, sql } from "drizzle-orm";
import { requireAuth, requireAdmin, type AuthRequest } from "../middlewares/auth";
import { isLead } from "../lib/roles";

const router = Router();
const VIS = ["all", "team", "user"] as const;
type Visibility = (typeof VIS)[number];

/** Rows the caller may see/use. ?scope=manage (admins) returns everything. */
router.get("/quick-replies", requireAuth, async (req: AuthRequest, res) => {
  const me = req.user!;
  const all = req.query["scope"] === "manage" && me.role === "admin";
  const r = await db.execute(sql`
    SELECT q.id, q.title, q.body, q.category_id AS "categoryId", q.shortcut, q.visibility, q.team_id AS "teamId",
           q.owner_id AS "ownerId", q.language, q.usage_count AS "usageCount", q.last_used_at AS "lastUsedAt", q.created_at AS "createdAt",
           c.name AS "categoryName", t.name AS "teamName", COALESCE(o.display_name, o.name) AS "ownerName"
    FROM quick_replies q
    LEFT JOIN quick_reply_categories c ON c.id = q.category_id
    LEFT JOIN teams t ON t.id = q.team_id
    LEFT JOIN users o ON o.id = q.owner_id
    ${all ? sql`` : sql`WHERE q.visibility = 'all'
      OR (q.visibility = 'team' AND q.team_id IS NOT NULL AND q.team_id = ${me.teamId ?? -1})
      OR (q.visibility = 'user' AND q.owner_id = ${me.id})
      ${isLead(me.role) ? sql`OR q.visibility = 'team'` : sql``}`}
    ORDER BY c.sort_order NULLS LAST, c.name NULLS LAST, q.title
  `);
  res.json(r.rows ?? []);
});

function parse(body: Record<string, unknown>, me: { id: number; role: string }) {
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 80) : "";
  const text = typeof body.body === "string" ? body.body.trim().slice(0, 4000) : "";
  let visibility: Visibility = VIS.includes(body.visibility as Visibility) ? (body.visibility as Visibility) : "all";
  if (me.role === "agent") visibility = "user"; // agents can only keep personal replies
  const shortcut = typeof body.shortcut === "string" && body.shortcut.trim()
    ? body.shortcut.trim().replace(/^\/+/, "").toLowerCase().replace(/[^a-z0-9_\-؀-ۿ]/g, "").slice(0, 30) || null
    : null;
  const teamId = visibility === "team" && Number.isInteger(body.teamId) ? (body.teamId as number) : null;
  return {
    title, body: text, visibility, shortcut, teamId,
    categoryId: Number.isInteger(body.categoryId) ? (body.categoryId as number) : null,
    language: body.language === "ar" || body.language === "en" ? body.language : null,
    ownerId: visibility === "user" ? me.id : null,
  };
}

function canManage(me: { id: number; role: string }, row: { visibility: string; ownerId: number | null }): boolean {
  if (me.role === "admin") return true;
  if (row.visibility === "user") return row.ownerId === me.id;
  return isLead(me.role);
}

router.post("/quick-replies", requireAuth, async (req: AuthRequest, res) => {
  const me = req.user!;
  const v = parse(req.body ?? {}, me);
  if (!v.title || !v.body) { res.status(400).json({ error: "title and body required" }); return; }
  if (v.visibility === "team" && !v.teamId) { res.status(400).json({ error: "Choose the team that can use this reply" }); return; }
  if (v.visibility !== "user" && !isLead(me.role)) { res.status(403).json({ error: "Only admins and supervisors can share replies" }); return; }
  const [reply] = await db.insert(quickRepliesTable).values(v).returning();
  res.status(201).json(reply);
});

router.put("/quick-replies/:id", requireAuth, async (req: AuthRequest, res) => {
  const me = req.user!;
  const id = Number(req.params.id);
  const [row] = await db.select().from(quickRepliesTable).where(eq(quickRepliesTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (!canManage(me, row)) { res.status(403).json({ error: "Forbidden" }); return; }
  const v = parse({ ...row, ...req.body }, row.visibility === "user" && row.ownerId !== me.id ? { id: row.ownerId!, role: me.role } : me);
  if (!v.title || !v.body) { res.status(400).json({ error: "title and body required" }); return; }
  if (v.visibility === "team" && !v.teamId) { res.status(400).json({ error: "Choose the team that can use this reply" }); return; }
  const [updated] = await db.update(quickRepliesTable).set(v).where(eq(quickRepliesTable.id, id)).returning();
  res.json(updated);
});

router.delete("/quick-replies/:id", requireAuth, async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(quickRepliesTable).where(eq(quickRepliesTable.id, id));
  if (!row) { res.status(204).send(); return; }
  if (!canManage(req.user!, row)) { res.status(403).json({ error: "Forbidden" }); return; }
  await db.delete(quickRepliesTable).where(eq(quickRepliesTable.id, id));
  res.status(204).send();
});

// Usage counter (analytics: which replies are used most).
router.post("/quick-replies/:id/use", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  await db.update(quickRepliesTable)
    .set({ usageCount: sql`${quickRepliesTable.usageCount} + 1`, lastUsedAt: new Date() })
    .where(eq(quickRepliesTable.id, id));
  res.json({ ok: true });
});

// ── Categories ──────────────────────────────────────────────────────────────

router.get("/quick-reply-categories", requireAuth, async (_req, res) => {
  res.json(await db.select().from(quickReplyCategoriesTable).orderBy(asc(quickReplyCategoriesTable.sortOrder), asc(quickReplyCategoriesTable.name)));
});

router.post("/quick-reply-categories", requireAuth, requireAdmin, async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 60) : "";
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  try {
    const [row] = await db.insert(quickReplyCategoriesTable).values({ name, sortOrder: Number.isInteger(req.body?.sortOrder) ? req.body.sortOrder : 0 }).returning();
    res.status(201).json(row);
  } catch {
    res.status(409).json({ error: "This category already exists" });
  }
});

router.delete("/quick-reply-categories/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await db.update(quickRepliesTable).set({ categoryId: null }).where(eq(quickRepliesTable.categoryId, id));
  await db.delete(quickReplyCategoriesTable).where(eq(quickReplyCategoriesTable.id, id));
  res.status(204).send();
});

export default router;
