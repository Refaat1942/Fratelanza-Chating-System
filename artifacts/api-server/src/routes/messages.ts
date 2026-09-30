import { Router } from "express";
import { db } from "@workspace/db";
import { messagesTable, conversationsTable, customersTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { requirePermission } from "../middlewares/permissions";
import type { Server as IOServer } from "socket.io";
import { logger } from "../lib/logger";
import { sendWhatsAppText, whatsappSendingConfigured } from "../lib/whatsapp";

const router = Router();

async function canAccessConversation(userId: number, role: string, convId: number): Promise<boolean> {
  if (role === "admin") return true;
  const [conv] = await db
    .select({ assignedAgentId: conversationsTable.assignedAgentId })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, convId))
    .limit(1);
  return !!conv && conv.assignedAgentId === userId;
}

router.get("/conversations/:id/messages", requireAuth, requirePermission("canViewChats"), async (req: AuthRequest, res) => {
  const convId = Number(req.params.id);
  const allowed = await canAccessConversation(req.user!.id, req.user!.role, convId);
  if (!allowed) { res.status(403).json({ error: "Forbidden" }); return; }

  const messages = await db.select().from(messagesTable)
    .where(eq(messagesTable.conversationId, convId))
    .orderBy(asc(messagesTable.createdAt));
  res.json(messages);
});

router.post("/conversations/:id/messages", requireAuth, requirePermission("canSendMessages"), async (req: AuthRequest, res) => {
  const convId = Number(req.params.id);
  const allowed = await canAccessConversation(req.user!.id, req.user!.role, convId);
  if (!allowed) { res.status(403).json({ error: "Forbidden" }); return; }

  const { body, isNote, attachments } = req.body;
  if (!body) {
    res.status(400).json({ error: "body required" });
    return;
  }

  // Block guard: if the customer attached to this conversation is blocked,
  // refuse outbound messages but still allow internal notes (so staff can
  // record the reason / context without contacting the customer).
  if (!isNote) {
    const [blockRow] = await db
      .select({ isBlocked: customersTable.isBlocked })
      .from(conversationsTable)
      .leftJoin(customersTable, eq(conversationsTable.customerId, customersTable.id))
      .where(eq(conversationsTable.id, convId))
      .limit(1);
    if (blockRow?.isBlocked) {
      res.status(403).json({ error: "Customer is blocked. Unblock to send messages." });
      return;
    }
  }

  // Sender identity is ALWAYS derived from the authenticated user — never
  // trust a client-supplied senderType, which would let any logged-in user
  // impersonate the customer or system and corrupt analytics.
  const senderType: "agent" | "system" =
    req.user!.role === "admin" || req.user!.role === "agent" ? "agent" : "system";

  const [message] = await db.insert(messagesTable).values({
    conversationId: convId,
    senderId: req.user?.id || null,
    senderType,
    body,
    attachments: attachments || [],
    isNote: isNote || false,
    status: "sent",
  }).returning();

  // Smart pending detection: when an agent replies in an open conversation,
  // mark it as "pending" — i.e. we are now waiting on the customer. Internal
  // notes do NOT change status (they aren't visible to the customer). When the
  // customer replies via the inbound channel, that path will set status='open'
  // again. We never override 'completed' here.
  const [current] = await db
    .select({ status: conversationsTable.status })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, convId));

  const shouldFlipToPending =
    !isNote &&
    senderType === "agent" &&
    current?.status === "open";

  await db
    .update(conversationsTable)
    .set({
      lastMessage: body,
      lastMessageAt: new Date(),
      lastSenderType: senderType,
      ...(shouldFlipToPending ? { status: "pending" as const } : {}),
    })
    .where(eq(conversationsTable.id, convId));

  // Deliver through the WhatsApp Cloud API. Internal notes never leave the CRM.
  // On failure the message stays in the thread flagged "failed" so the agent
  // can see it was NOT delivered (e.g. outside the 24h customer-service window).
  let delivered: typeof message = message;
  let deliveryError: string | undefined;
  if (!isNote && whatsappSendingConfigured()) {
    const [target] = await db
      .select({ channel: conversationsTable.channel, phone: customersTable.phone })
      .from(conversationsTable)
      .leftJoin(customersTable, eq(conversationsTable.customerId, customersTable.id))
      .where(eq(conversationsTable.id, convId))
      .limit(1);
    if (target?.channel === "whatsapp" && target.phone) {
      try {
        const { externalId } = await sendWhatsAppText(target.phone, body);
        [delivered] = await db
          .update(messagesTable)
          .set({ externalId })
          .where(eq(messagesTable.id, message.id))
          .returning();
      } catch (err) {
        deliveryError = err instanceof Error ? err.message : "WhatsApp send failed";
        logger.error({ err, messageId: message.id }, "WhatsApp send failed");
        [delivered] = await db
          .update(messagesTable)
          .set({ status: "failed" })
          .where(eq(messagesTable.id, message.id))
          .returning();
      }
    }
  }

  const io: IOServer = (req as AuthRequest & { app: { get: (k: string) => IOServer } }).app.get("io");
  if (io) {
    io.to(`conv:${convId}`).emit("new_message", delivered);
  }

  res.status(201).json(deliveryError ? { ...delivered, deliveryError } : delivered);
});

export default router;
