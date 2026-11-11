/** Bots: CRUD + activation (admins), simulator, analytics. */
import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { db, botsTable, teamsTable, chatReasonsTable } from "@workspace/db";
import { requireAuth, requireAdmin, type AuthRequest } from "../middlewares/auth";
import { requirePermission } from "../middlewares/permissions";
import { advanceBot, startBot, validateFlow, type BotAction, type BotState, type BotStep } from "../lib/bot-engine";
import { toDef, isOffHours } from "../lib/bot-runtime";
import { logAudit } from "../lib/audit";

const router = Router();
const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) || null : null);

function cleanSteps(v: unknown): BotStep[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 60).map((x) => {
    const s = (x ?? {}) as Record<string, unknown>;
    const kind = s.kind === "menu" || s.kind === "question" ? s.kind : "message";
    const step: BotStep = { key: String(s.key ?? "").trim().slice(0, 40), kind, text: String(s.text ?? "").slice(0, 2000) };
    if (s.next !== undefined) step.next = typeof s.next === "string" && s.next ? s.next : null;
    if (kind === "question") step.saveTo = typeof s.saveTo === "string" ? s.saveTo : "answer";
    if (kind === "menu") {
      step.options = (Array.isArray(s.options) ? s.options : []).slice(0, 10).map((o) => {
        const oo = (o ?? {}) as Record<string, unknown>;
        const actions: BotAction[] = [];
        for (const a of Array.isArray(oo.actions) ? oo.actions : []) {
          const aa = (a ?? {}) as Record<string, unknown>;
          if (aa.type === "route_team" && Number.isInteger(aa.teamId)) actions.push({ type: "route_team", teamId: aa.teamId as number });
          else if (aa.type === "set_topic" && Number.isInteger(aa.topicId)) actions.push({ type: "set_topic", topicId: aa.topicId as number });
          else if (aa.type === "tag" && typeof aa.tag === "string" && aa.tag.trim()) actions.push({ type: "tag", tag: aa.tag.trim().slice(0, 40) });
          else if (aa.type === "handover") actions.push({ type: "handover" });
          else if (aa.type === "close") actions.push({ type: "close" });
        }
        return { label: String(oo.label ?? "").slice(0, 100), ...(oo.next !== undefined ? { next: typeof oo.next === "string" && oo.next ? oo.next : null } : {}), actions };
      });
    }
    return step;
  });
}

async function known() {
  const teams = (await db.select({ id: teamsTable.id }).from(teamsTable)).map((t) => t.id);
  const topics = (await db.select({ id: chatReasonsTable.id }).from(chatReasonsTable)).map((t) => t.id);
  return { teams, topics };
}

function payload(b: Record<string, unknown>) {
  const oh = (b.offHours ?? null) as Record<string, unknown> | null;
  return {
    name: str(b.name, 80) ?? "Untitled bot",
    description: str(b.description, 300),
    kind: (b.kind === "survey" || b.kind === "action" ? b.kind : "menu") as "menu" | "survey" | "action",
    channel: ["all", "whatsapp", "messenger", "instagram"].includes(String(b.channel)) ? String(b.channel) : "all",
    trigger: b.trigger === "keyword" ? "keyword" as const : "new_conversation" as const,
    keywords: Array.isArray(b.keywords) ? b.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 50) : [],
    welcomeMessage: str(b.welcomeMessage), fallbackMessage: str(b.fallbackMessage),
    handoverMessage: str(b.handoverMessage), completionMessage: str(b.completionMessage),
    endAction: b.endAction === "close" ? "close" as const : "handover" as const,
    maxFallbacks: Math.min(5, Math.max(0, Number(b.maxFallbacks ?? 2) || 0)),
    priority: Math.min(100, Math.max(0, Number(b.priority ?? 0) || 0)),
    offHours: oh && typeof oh === "object"
      ? {
          enabled: !!oh.enabled,
          start: /^\d{2}:\d{2}$/.test(String(oh.start)) ? String(oh.start) : "09:00",
          end: /^\d{2}:\d{2}$/.test(String(oh.end)) ? String(oh.end) : "21:00",
          days: Array.isArray(oh.days) ? (oh.days as unknown[]).map(Number).filter((d) => d >= 0 && d <= 6) : [],
          message: String(oh.message ?? "").slice(0, 1000),
        }
      : null,
    steps: cleanSteps(b.steps),
    updatedAt: new Date(),
  };
}

router.get("/bots", requireAuth, requireAdmin, async (_req, res) => {
  const r = await db.execute(sql`
    SELECT b.*,
      COUNT(s.id)::int AS sessions,
      COUNT(s.id) FILTER (WHERE s.status = 'active' AND s.last_activity_at > NOW() - INTERVAL '24 hours')::int AS active_sessions,
      COUNT(s.id) FILTER (WHERE s.status = 'completed')::int AS completed,
      COUNT(s.id) FILTER (WHERE s.status = 'handed_over')::int AS handed_over,
      COUNT(s.id) FILTER (WHERE s.status = 'abandoned' OR (s.status = 'active' AND s.last_activity_at <= NOW() - INTERVAL '24 hours'))::int AS abandoned
    FROM bots b LEFT JOIN bot_sessions s ON s.bot_id = b.id
    GROUP BY b.id ORDER BY b.priority DESC, b.id
  `);
  res.json(r.rows ?? []);
});

router.get("/bots/:id", requireAuth, requireAdmin, async (req, res) => {
  const [b] = await db.select().from(botsTable).where(eq(botsTable.id, Number(req.params.id)));
  if (!b) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...b, problems: validateFlow((b.steps ?? []) as BotStep[], await known()) });
});

router.post("/bots", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const [b] = await db.insert(botsTable).values({ ...payload(req.body ?? {}), isActive: false }).returning();
  void logAudit({ actorId: req.user!.id, action: "bot.created", entityType: "bot", entityId: b!.id, details: { name: b!.name } });
  res.status(201).json(b);
});

router.put("/bots/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const p = payload(req.body ?? {});
  const [cur] = await db.select().from(botsTable).where(eq(botsTable.id, id));
  if (!cur) { res.status(404).json({ error: "Not found" }); return; }
  // An active bot must stay valid.
  if (cur.isActive) {
    const problems = validateFlow(p.steps, await known());
    if (problems.length) { res.status(400).json({ error: "Fix the flow before saving an active bot", problems }); return; }
  }
  const [b] = await db.update(botsTable).set(p).where(eq(botsTable.id, id)).returning();
  void logAudit({ actorId: req.user!.id, action: "bot.updated", entityType: "bot", entityId: id });
  res.json(b);
});

router.post("/bots/:id/active", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const on = req.body?.isActive === true;
  const [b] = await db.select().from(botsTable).where(eq(botsTable.id, id));
  if (!b) { res.status(404).json({ error: "Not found" }); return; }
  if (on) {
    const problems = validateFlow((b.steps ?? []) as BotStep[], await known());
    if (problems.length) { res.status(400).json({ error: "This bot can't be switched on yet", problems }); return; }
    if (b.trigger === "keyword" && !b.keywords.length) { res.status(400).json({ error: "Add at least one keyword for a keyword-triggered bot" }); return; }
  }
  const [u] = await db.update(botsTable).set({ isActive: on, updatedAt: new Date() }).where(eq(botsTable.id, id)).returning();
  if (!on) await db.execute(sql`UPDATE bot_sessions SET status = 'handed_over', ended_at = NOW() WHERE bot_id = ${id} AND status = 'active'`);
  void logAudit({ actorId: req.user!.id, action: on ? "bot.activated" : "bot.deactivated", entityType: "bot", entityId: id, details: { name: b.name } });
  res.json(u);
});

router.delete("/bots/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  await db.execute(sql`UPDATE bot_sessions SET status = 'handed_over', ended_at = NOW() WHERE bot_id = ${id} AND status = 'active'`);
  await db.delete(botsTable).where(eq(botsTable.id, id));
  void logAudit({ actorId: req.user!.id, action: "bot.deleted", entityType: "bot", entityId: id });
  res.status(204).send();
});

/** Dry run: nothing is stored or sent. Send the draft bot and the conversation so far. */
router.post("/bots/simulate", requireAuth, requireAdmin, async (req, res) => {
  const def = toDef({ ...payload(req.body?.bot ?? {}), id: 0, isActive: true, createdAt: new Date() } as never);
  const state = req.body?.state as BotState | undefined;
  const input = typeof req.body?.input === "string" ? req.body.input : null;
  const turn = !state || input === null ? startBot(def) : advanceBot(def, state, input);
  const oh = payload(req.body?.bot ?? {}).offHours;
  if ((!state || input === null) && isOffHours(oh) && oh?.message) turn.replies.unshift(oh.message);
  res.json(turn);
});

// Which menu options customers pick (from stored answers).
router.get("/bots/:id/analytics", requireAuth, requirePermission("canViewReports"), async (req, res) => {
  const id = Number(req.params.id);
  const r = await db.execute(sql`
    SELECT kv.key AS step, kv.value AS answer, COUNT(*)::int AS n
    FROM bot_sessions s, jsonb_each_text(s.answers) kv
    WHERE s.bot_id = ${id}
    GROUP BY kv.key, kv.value ORDER BY kv.key, n DESC LIMIT 200
  `);
  const d = await db.execute(sql`
    SELECT date_trunc('day', started_at)::date AS day, COUNT(*)::int AS sessions,
      COUNT(*) FILTER (WHERE status = 'handed_over')::int AS handed_over,
      COUNT(*) FILTER (WHERE status = 'completed')::int AS completed
    FROM bot_sessions WHERE bot_id = ${id} AND started_at > NOW() - INTERVAL '30 days'
    GROUP BY 1 ORDER BY 1
  `);
  res.json({ answers: r.rows ?? [], daily: d.rows ?? [] });
});

export default router;
