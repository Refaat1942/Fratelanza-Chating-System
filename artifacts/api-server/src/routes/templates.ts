/** WhatsApp templates: list, sync (admin), send into a chat, analytics. */
import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { db, whatsappTemplatesTable, conversationsTable, customersTable, messagesTable } from "@workspace/db";
import type { Server as IOServer } from "socket.io";
import { requireAuth, requireAdmin, type AuthRequest } from "../middlewares/auth";
import { requirePermission } from "../middlewares/permissions";
import { canSendInConversation } from "../lib/access";
import { outboundEnabled, OUTBOUND_DISABLED_ERROR } from "../lib/outbound";
import { logAudit } from "../lib/audit";
import { logger } from "../lib/logger";
import { renderTemplate, sendTemplate, syncTemplates, templatesConfigured, validateParams, type TemplateParams } from "../lib/wa-templates";

const router = Router();

router.get("/whatsapp/templates", requireAuth, async (req: AuthRequest, res) => {
  const onlyApproved = req.user!.role !== "admin" || req.query["all"] !== "1";
  const rows = await db
    .select()
    .from(whatsappTemplatesTable)
    .where(onlyApproved ? eq(whatsappTemplatesTable.status, "APPROVED") : undefined)
    .orderBy(whatsappTemplatesTable.name, whatsappTemplatesTable.language);
  res.json({ configured: templatesConfigured(), templates: rows });
});

router.post("/whatsapp/templates/sync", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const r = await syncTemplates();
    void logAudit({ actorId: req.user!.id, action: "templates.synced", entityType: "settings", details: r });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Sync failed" });
  }
});

function cleanParams(v: unknown): TemplateParams {
  const pick = (o: unknown) => {
    const out: Record<string, string> = {};
    if (o && typeof o === "object") for (const [k, x] of Object.entries(o as Record<string, unknown>)) if (typeof x === "string") out[k] = x.slice(0, 1000);
    return out;
  };
  const p = (v ?? {}) as { header?: unknown; body?: unknown };
  return { header: pick(p.header), body: pick(p.body) };
}

router.post("/conversations/:id/template", requireAuth, requirePermission("canSendMessages"), async (req: AuthRequest, res) => {
  const convId = Number(req.params.id);
  if (!(await canSendInConversation(req.user!, convId))) { res.status(403).json({ error: "Forbidden" }); return; }
  if (!outboundEnabled()) { res.status(403).json(OUTBOUND_DISABLED_ERROR); return; }
  const templateId = Number(req.body?.templateId);
  const [tpl] = await db.select().from(whatsappTemplatesTable).where(eq(whatsappTemplatesTable.id, templateId));
  if (!tpl || tpl.status !== "APPROVED") { res.status(400).json({ error: "Choose an approved template" }); return; }
  const [target] = await db
    .select({ channel: conversationsTable.channel, phone: customersTable.phone, isBlocked: customersTable.isBlocked, status: conversationsTable.status })
    .from(conversationsTable)
    .leftJoin(customersTable, eq(conversationsTable.customerId, customersTable.id))
    .where(eq(conversationsTable.id, convId));
  if (!target) { res.status(404).json({ error: "Not found" }); return; }
  if (target.channel !== "whatsapp") { res.status(400).json({ error: "Templates are for WhatsApp chats" }); return; }
  if (target.isBlocked) { res.status(403).json({ error: "Customer is blocked. Unblock to send messages." }); return; }

  const components = (tpl.components ?? []) as Parameters<typeof renderTemplate>[0];
  const params = cleanParams(req.body?.params);
  const invalid = validateParams(components, params);
  if (invalid) { res.status(400).json({ error: invalid }); return; }
  const body = renderTemplate(components, params);

  const [message] = await db.insert(messagesTable).values({
    conversationId: convId, senderId: req.user!.id, senderType: "agent", body, status: "sent", templateId: tpl.id,
  }).returning();
  let delivered = message!;
  let deliveryError: string | undefined;
  try {
    const { externalId } = await sendTemplate(target.phone ?? "", tpl.name, tpl.language, components, params);
    [delivered] = await db.update(messagesTable).set({ externalId }).where(eq(messagesTable.id, message!.id)).returning();
  } catch (err) {
    deliveryError = err instanceof Error ? err.message : "Template send failed";
    logger.error({ err, messageId: message!.id }, "WhatsApp template send failed");
    [delivered] = await db.update(messagesTable).set({ status: "failed" }).where(eq(messagesTable.id, message!.id)).returning();
  }
  await db.update(conversationsTable).set({
    lastMessage: body, lastMessageAt: new Date(), lastSenderType: "agent",
    ...(target.status === "open" ? { status: "pending" as const } : {}),
  }).where(eq(conversationsTable.id, convId));
  await db.update(whatsappTemplatesTable).set({ usageCount: sql`${whatsappTemplatesTable.usageCount} + 1`, lastUsedAt: new Date() }).where(eq(whatsappTemplatesTable.id, tpl.id));

  const io = req.app.get("io") as IOServer | undefined;
  io?.to(`conv:${convId}`).emit("new_message", delivered);
  io?.emit("conversation_updated", { conversationId: convId });
  res.status(201).json(deliveryError ? { ...delivered, deliveryError } : delivered);
});

// Per template: sent / delivered / read / failed and how many got a customer reply within 24h.
router.get("/whatsapp/templates/analytics", requireAuth, requirePermission("canViewReports"), async (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query["days"]) || 30));
  const r = await db.execute(sql`
    SELECT t.id, t.name, t.language, t.category, t.status,
      COUNT(m.id)::int AS sent,
      COUNT(m.id) FILTER (WHERE m.status IN ('delivered','read'))::int AS delivered,
      COUNT(m.id) FILTER (WHERE m.status = 'read')::int AS read,
      COUNT(m.id) FILTER (WHERE m.status = 'failed')::int AS failed,
      COUNT(m.id) FILTER (WHERE EXISTS (
        SELECT 1 FROM messages r WHERE r.conversation_id = m.conversation_id AND r.sender_type = 'customer'
          AND r.created_at > m.created_at AND r.created_at <= m.created_at + INTERVAL '24 hours'))::int AS replied
    FROM whatsapp_templates t
    LEFT JOIN messages m ON m.template_id = t.id AND m.created_at > NOW() - make_interval(days => ${days})
    GROUP BY t.id
    ORDER BY sent DESC, t.name
  `);
  res.json({ days, rows: r.rows ?? [] });
});

export default router;
