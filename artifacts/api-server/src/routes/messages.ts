import { Router } from "express";
import { db } from "@workspace/db";
import { messagesTable, conversationsTable, customersTable } from "@workspace/db";
import { eq, asc, and, gt } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { requirePermission } from "../middlewares/permissions";
import type { Server as IOServer } from "socket.io";
import { logger } from "../lib/logger";
import { sendWhatsAppText, whatsappSendingConfigured } from "../lib/whatsapp";
import { sendSocialText, socialSendingConfigured } from "../lib/meta-social";
import { outboundEnabled, OUTBOUND_DISABLED_ERROR } from "../lib/outbound";
import { canReadConversation, canSendInConversation } from "../lib/access";

const router = Router();

router.get("/conversations/:id/messages", requireAuth, requirePermission("canViewChats"), async (req: AuthRequest, res) => {
  const convId = Number(req.params.id);
  const allowed = await canReadConversation(req.user!, convId);
  if (!allowed) { res.status(403).json({ error: "Forbidden" }); return; }

  // ?afterId=N returns only newer messages (cheap incremental polling).
  const afterId = Number(req.query["afterId"]);
  const where = Number.isInteger(afterId) && afterId > 0
    ? and(eq(messagesTable.conversationId, convId), gt(messagesTable.id, afterId))
    : eq(messagesTable.conversationId, convId);
  const messages = await db.select().from(messagesTable)
    .where(where)
    .orderBy(asc(messagesTable.createdAt), asc(messagesTable.id));
  res.json(messages);
});

router.post("/conversations/:id/messages", requireAuth, requirePermission("canSendMessages"), async (req: AuthRequest, res) => {
  const convId = Number(req.params.id);
  const allowed = await canSendInConversation(req.user!, convId);
  if (!allowed) { res.status(403).json({ error: "Forbidden" }); return; }

  const { body, isNote, attachments } = req.body;
  if (!body) {
    res.status(400).json({ error: "body required" });
    return;
  }

  // Kill switch: nothing leaves this server for a customer unless the owner
  // turned sending on (WHATSAPP_SENDING_ENABLED=true). Notes are always fine.
  if (!isNote && !outboundEnabled()) {
    res.status(403).json(OUTBOUND_DISABLED_ERROR);
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
    req.user!.role === "admin" || req.user!.role === "supervisor" || req.user!.role === "agent" ? "agent" : "system";

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

  // Internal notes are invisible to the customer, so they must not change the
  // chat's "last message", who spoke last, or its age — otherwise a note would
  // make an unanswered customer look answered.
  if (!isNote) {
    await db
      .update(conversationsTable)
      .set({
        lastMessage: body,
        lastMessageAt: new Date(),
        lastSenderType: senderType,
        ...(shouldFlipToPending ? { status: "pending" as const } : {}),
      })
      .where(eq(conversationsTable.id, convId));
  }

  // Deliver through the conversation's channel (WhatsApp Cloud API, or the
  // Messenger/Instagram Send API). Internal notes never leave the CRM. On
  // failure the message stays in the thread flagged "failed" so the agent can
  // see it was NOT delivered (e.g. outside the 24h customer-service window).
  let delivered: typeof message = message;
  let deliveryError: string | undefined;
  if (!isNote && outboundEnabled()) {
    const [target] = await db
      .select({
        channel: conversationsTable.channel,
        phone: customersTable.phone,
        messengerPsid: customersTable.messengerPsid,
        instagramId: customersTable.instagramId,
      })
      .from(conversationsTable)
      .leftJoin(customersTable, eq(conversationsTable.customerId, customersTable.id))
      .where(eq(conversationsTable.id, convId))
      .limit(1);
    let send: (() => Promise<{ externalId: string }>) | null = null;
    if (target?.channel === "whatsapp" && target.phone && whatsappSendingConfigured()) {
      send = () => sendWhatsAppText(target.phone!, body);
    } else if (target?.channel === "messenger" && target.messengerPsid && socialSendingConfigured("messenger")) {
      send = () => sendSocialText("messenger", target.messengerPsid!, body);
    } else if (target?.channel === "instagram" && target.instagramId && socialSendingConfigured("instagram")) {
      send = () => sendSocialText("instagram", target.instagramId!, body);
    }
    if (send) {
      try {
        const { externalId } = await send();
        [delivered] = await db
          .update(messagesTable)
          .set({ externalId })
          .where(eq(messagesTable.id, message.id))
          .returning();
      } catch (err) {
        deliveryError = err instanceof Error ? err.message : "Send failed";
        logger.error({ err, messageId: message.id, channel: target?.channel }, "Outbound send failed");
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
    io.emit("conversation_updated", { conversationId: convId });
  }

  res.status(201).json(deliveryError ? { ...delivered, deliveryError } : delivered);
});

export default router;
