import { Router, type Request } from "express";
import { db } from "@workspace/db";
import {
  customersTable,
  conversationsTable,
  messagesTable,
} from "@workspace/db";
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import type { Server as IOServer } from "socket.io";
import { logger } from "../lib/logger";
import { tryAutoAssign } from "../lib/assignment";
import {
  digitsOnly,
  parseWhatsAppWebhook,
  safeEqual,
  verifyMetaSignature,
  whatsappConfig,
} from "../lib/whatsapp";

const router = Router();

type Provider = "whatsapp" | "messenger" | "instagram";

interface InboundPayload {
  from?: string;
  phone?: string;
  name?: string;
  message?: string;
  body?: string;
  externalId?: string;
}

function getIo(req: Request): IOServer | undefined {
  return req.app.get("io") as IOServer | undefined;
}

/**
 * Store one inbound customer message: find/create the customer and an active
 * conversation, insert the message (idempotent on externalId), bump counters,
 * and run auto-assignment for new/unassigned conversations.
 */
async function ingestInbound(
  provider: Provider,
  payload: InboundPayload,
  io?: IOServer,
): Promise<{
  customerId: number;
  conversationId: number;
  messageId: number;
  duplicate: boolean;
}> {
  const rawPhone = String(payload.phone ?? payload.from ?? "").trim();
  const digits = digitsOnly(rawPhone);
  const body = String(payload.message ?? payload.body ?? "").trim();
  if (!digits || !body) {
    throw new Error("phone/from and message/body are required");
  }
  const externalId = payload.externalId?.trim() || null;

  // Fast path: Meta retries deliveries it believes failed.
  if (externalId) {
    const [dup] = await db
      .select({
        id: messagesTable.id,
        conversationId: messagesTable.conversationId,
      })
      .from(messagesTable)
      .where(eq(messagesTable.externalId, externalId))
      .limit(1);
    if (dup) {
      const [c] = await db
        .select({ customerId: conversationsTable.customerId })
        .from(conversationsTable)
        .where(eq(conversationsTable.id, dup.conversationId));
      return {
        customerId: c?.customerId ?? 0,
        conversationId: dup.conversationId,
        messageId: dup.id,
        duplicate: true,
      };
    }
  }

  // Match the customer by digits so "+20 100 123 4567", "0100…" exports and
  // Meta's "201001234567" all resolve to the same record.
  let [customer] = await db
    .select()
    .from(customersTable)
    .where(sql`regexp_replace(${customersTable.phone}, '\\D', '', 'g') = ${digits}`)
    .limit(1);

  if (!customer) {
    [customer] = await db
      .insert(customersTable)
      .values({
        name: payload.name?.trim() || `+${digits}`,
        phone: `+${digits}`,
        tags: ["New"],
      })
      .returning();
  }

  // Active = open OR pending. (Pending = waiting on customer / queued.) Using
  // only "open" here would spawn a fresh conversation on every reply that
  // arrives after an agent answered.
  let [conv] = await db
    .select()
    .from(conversationsTable)
    .where(
      and(
        eq(conversationsTable.customerId, customer.id),
        eq(conversationsTable.channel, provider),
        inArray(conversationsTable.status, ["open", "pending"]),
      ),
    )
    .orderBy(desc(conversationsTable.createdAt))
    .limit(1);

  const now = new Date();
  let isNewConversation = false;
  if (!conv) {
    [conv] = await db
      .insert(conversationsTable)
      .values({
        customerId: customer.id,
        channel: provider,
        status: "open",
        lastMessage: body,
        lastMessageAt: now,
        lastSenderType: "customer",
        unreadCount: 0,
      })
      .returning();
    isNewConversation = true;
  }

  const inserted = await db
    .insert(messagesTable)
    .values({
      conversationId: conv.id,
      senderType: "customer",
      body,
      status: "delivered",
      externalId,
    })
    .onConflictDoNothing({ target: messagesTable.externalId })
    .returning();

  if (inserted.length === 0) {
    return {
      customerId: customer.id,
      conversationId: conv.id,
      messageId: 0,
      duplicate: true,
    };
  }
  const message = inserted[0];

  await db
    .update(conversationsTable)
    .set({
      // A customer reply re-opens an assigned chat. Unassigned ("queued")
      // chats keep their status until drainQueue/auto-assign picks them up.
      ...(conv.assignedAgentId || isNewConversation ? { status: "open" as const } : {}),
      lastMessage: body,
      lastMessageAt: now,
      lastSenderType: "customer",
      unreadCount: sql`${conversationsTable.unreadCount} + 1`,
    })
    .where(eq(conversationsTable.id, conv.id));

  if (!conv.assignedAgentId) {
    try {
      await tryAutoAssign(conv.id, io);
    } catch (err) {
      logger.error({ err, conversationId: conv.id }, "Auto-assign failed");
    }
  }

  if (io) {
    io.to(`conv:${conv.id}`).emit("new_message", message);
    io.emit("conversation_updated", { conversationId: conv.id });
  }

  return {
    customerId: customer.id,
    conversationId: conv.id,
    messageId: message.id,
    duplicate: false,
  };
}

/* ------------------------ WhatsApp Cloud API (Meta) ----------------------- */

// Step 1 — Meta calls this once when you click "Verify and save".
router.get("/webhooks/whatsapp", (req, res) => {
  const { verifyToken } = whatsappConfig();
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (
    verifyToken &&
    mode === "subscribe" &&
    typeof token === "string" &&
    typeof challenge === "string" &&
    safeEqual(token, verifyToken)
  ) {
    res.status(200).type("text/plain").send(challenge);
    return;
  }
  logger.warn("WhatsApp webhook verification rejected");
  res.sendStatus(403);
});

// Step 2 — Meta POSTs inbound messages and delivery statuses here.
router.post("/webhooks/whatsapp", async (req, res) => {
  const { appSecret } = whatsappConfig();
  if (!appSecret) {
    // Fail closed: never accept unsigned data into the inbox.
    logger.error("WHATSAPP_APP_SECRET is not set — rejecting webhook");
    res.sendStatus(503);
    return;
  }
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  const signature = req.header("x-hub-signature-256");
  if (!verifyMetaSignature(rawBody, signature, appSecret)) {
    logger.warn("WhatsApp webhook signature mismatch");
    res.sendStatus(401);
    return;
  }

  const io = getIo(req);
  const { messages, statuses } = parseWhatsAppWebhook(req.body);

  for (const m of messages) {
    try {
      await ingestInbound(
        "whatsapp",
        { from: m.from, name: m.name, body: m.body, externalId: m.externalId },
        io,
      );
    } catch (err) {
      logger.error({ err, externalId: m.externalId }, "WhatsApp inbound failed");
    }
  }

  const rank = { sent: 1, delivered: 2, read: 3, failed: 4 } as const;
  for (const s of statuses) {
    try {
      const [row] = await db
        .select({ id: messagesTable.id, status: messagesTable.status })
        .from(messagesTable)
        .where(eq(messagesTable.externalId, s.externalId))
        .limit(1);
      // Callbacks can arrive out of order: never step backwards.
      if (!row || rank[s.status] <= rank[row.status]) continue;
      await db
        .update(messagesTable)
        .set({ status: s.status })
        .where(eq(messagesTable.id, row.id));
      io?.emit("message_status", { messageId: row.id, status: s.status });
      if (s.status === "failed") {
        logger.warn({ externalId: s.externalId, error: s.error }, "WhatsApp delivery failed");
      }
    } catch (err) {
      logger.error({ err, externalId: s.externalId }, "WhatsApp status update failed");
    }
  }

  // Always 200 once the signature is valid, otherwise Meta keeps retrying.
  res.sendStatus(200);
});

/* ---------------------- Generic JSON hook (Messenger etc.) ---------------- */

router.post("/webhooks/:provider", async (req, res) => {
  const secret = process.env.WEBHOOK_SECRET;
  const supplied = req.header("x-webhook-secret");
  if (!secret || !supplied || !safeEqual(supplied, secret)) {
    res.status(401).json({ error: "Invalid or missing webhook secret" });
    return;
  }

  const provider = req.params.provider as Provider;
  if (!["messenger", "instagram"].includes(provider)) {
    res.status(400).json({ error: "Unknown provider" });
    return;
  }

  try {
    const result = await ingestInbound(provider, req.body as InboundPayload, getIo(req));
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Invalid payload" });
  }
});

export default router;
