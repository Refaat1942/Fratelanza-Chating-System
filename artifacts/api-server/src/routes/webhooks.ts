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
import { classifyConversation, routeByTopic } from "../lib/topics";
import { recordWebhookEvent } from "../lib/webhook-stats";
import { attachMedia, downloadUrl, downloadWhatsAppMedia } from "../lib/media";
import { applyTemplateStatus } from "../lib/wa-templates";
import {
  digitsOnly,
  parseWhatsAppWebhook,
  parseBusinessAppSync,
  type SyncedMessage,
  type SyncedContact,
  safeEqual,
  verifyMetaSignature,
  whatsappConfig,
} from "../lib/whatsapp";
import {
  parseSocialWebhook,
  socialConfig,
  fetchSocialProfileName,
  type SocialChannel,
  type SocialInbound,
  type SocialReceipt,
} from "../lib/meta-social";

const router = Router();

type Provider = "whatsapp" | "messenger" | "instagram";

interface InboundPayload {
  from?: string;
  phone?: string;
  name?: string;
  message?: string;
  body?: string;
  externalId?: string;
  attachments?: string[];
}

function getIo(req: Request): IOServer | undefined {
  return req.app.get("io") as IOServer | undefined;
}

/** Match a customer by phone digits ("+20 100…", "0100…", "2010…" are one
 *  person); create one when unknown. */
async function findOrCreateCustomer(digits: string, name?: string) {
  const [existing] = await db
    .select()
    .from(customersTable)
    .where(sql`regexp_replace(${customersTable.phone}, '\\D', '', 'g') = ${digits}`)
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(customersTable)
    .values({ name: name?.trim() || `+${digits}`, phone: `+${digits}`, tags: ["New"] })
    .returning();
  return created;
}

/**
 * Store one message that already happened outside this app — sent from the
 * WhatsApp Business phone app (echo) or imported chat history. Never sends
 * anything; idempotent on the WhatsApp message id.
 */
async function importSyncedMessage(m: SyncedMessage, source: "echo" | "history", io?: IOServer): Promise<boolean> {
  const [dup] = await db
    .select({ id: messagesTable.id })
    .from(messagesTable)
    .where(eq(messagesTable.externalId, m.externalId))
    .limit(1);
  if (dup) return false;

  const customer = await findOrCreateCustomer(m.customer);
  const at = m.timestamp ?? new Date();

  let [conv] = await db
    .select()
    .from(conversationsTable)
    .where(and(eq(conversationsTable.customerId, customer.id), eq(conversationsTable.channel, "whatsapp")))
    .orderBy(desc(conversationsTable.createdAt))
    .limit(1);

  if (!conv) {
    const stale = Date.now() - at.getTime() > 7 * 24 * 3600 * 1000;
    [conv] = await db
      .insert(conversationsTable)
      .values({
        customerId: customer.id,
        channel: "whatsapp",
        // Imported old chats must not flood the active inbox.
        status: source === "history" && stale ? "completed" : "pending",
        lastMessage: m.body,
        lastMessageAt: at,
        lastSenderType: m.direction === "out" ? "agent" : "customer",
        unreadCount: 0,
        createdAt: at,
      })
      .returning();
  }

  const inserted = await db
    .insert(messagesTable)
    .values({
      conversationId: conv.id,
      senderType: m.direction === "out" ? "agent" : "customer",
      body: m.body,
      status: m.direction === "out" ? (m.status ?? "sent") : "delivered",
      externalId: m.externalId,
      createdAt: at,
    })
    .onConflictDoNothing({ target: messagesTable.externalId })
    .returning();
  if (inserted.length === 0) return false;

  // Echoes arrive live, so they are always the latest event (their whole-second
  // WhatsApp timestamp can be a moment "older" than our receive time for the
  // customer's last message). History is placed by its original date.
  const newer =
    source === "echo" || !conv.lastMessageAt || at.getTime() >= new Date(conv.lastMessageAt).getTime();
  const updates: Record<string, unknown> = {};
  if (newer) {
    updates.lastMessage = m.body;
    updates.lastMessageAt = at;
    updates.lastSenderType = m.direction === "out" ? "agent" : "customer";
  }
  if (source === "echo") {
    // Answered from the phone: the chat is handled and waiting on the customer.
    updates.unreadCount = 0;
    if (conv.status !== "pending") updates.status = "pending";
  }
  if (Object.keys(updates).length) {
    await db.update(conversationsTable).set(updates).where(eq(conversationsTable.id, conv.id));
  }
  if (m.direction === "in") {
    try { await classifyConversation(conv.id); } catch { /* non-critical */ }
  }
  if (io) {
    io.to(`conv:${conv.id}`).emit("new_message", inserted[0]);
    io.emit("conversation_updated", { conversationId: conv.id });
  }
  return true;
}

/** Contact names saved in the phone app replace auto-generated names only. */
async function applyContactSync(c: SyncedContact): Promise<void> {
  if (!c.name || c.action === "remove") return;
  const [existing] = await db
    .select({ id: customersTable.id, name: customersTable.name })
    .from(customersTable)
    .where(sql`regexp_replace(${customersTable.phone}, '\\D', '', 'g') = ${c.phone}`)
    .limit(1);
  if (!existing) return; // never import the whole phone address book
  if (/^\+?[\d\s-]+$/.test(existing.name.trim())) {
    await db.update(customersTable).set({ name: c.name }).where(eq(customersTable.id, existing.id));
  }
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
  /** Already-resolved customer (Messenger/Instagram have no phone number). */
  knownCustomer?: typeof customersTable.$inferSelect,
): Promise<{
  customerId: number;
  conversationId: number;
  messageId: number;
  duplicate: boolean;
}> {
  const rawPhone = String(payload.phone ?? payload.from ?? "").trim();
  const digits = digitsOnly(rawPhone);
  const body = String(payload.message ?? payload.body ?? "").trim();
  if ((!digits && !knownCustomer) || !body) {
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

  const customer = knownCustomer ?? (await findOrCreateCustomer(digits, payload.name));

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
      attachments: payload.attachments ?? [],
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

  try {
    await classifyConversation(conv.id);
  } catch (err) {
    logger.error({ err, conversationId: conv.id }, "Topic classification failed");
  }

  if (!conv.assignedAgentId) {
    try {
      await routeByTopic(conv.id);
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
  const sync = parseBusinessAppSync(req.body);

  // Diagnostics: which webhook fields Meta actually sends (Settings → WhatsApp).
  const fields = new Set<string>();
  for (const e of (req.body?.entry ?? []) as { changes?: { field?: string }[] }[]) {
    for (const c of e.changes ?? []) if (c.field) fields.add(c.field);
  }
  for (const f of fields) recordWebhookEvent(`field:${f}`);
  // Template approval / rejection updates (field "message_template_status_update").
  for (const e of (req.body?.entry ?? []) as { changes?: { field?: string; value?: Record<string, unknown> }[] }[]) {
    for (const c of e.changes ?? []) {
      if (c.field === "message_template_status_update" && c.value) {
        try { await applyTemplateStatus(c.value as Parameters<typeof applyTemplateStatus>[0]); }
        catch (err) { logger.error({ err }, "Template status update failed"); }
      }
    }
  }
  recordWebhookEvent("customer_message", messages.length);
  recordWebhookEvent("status_update", statuses.length);
  recordWebhookEvent("phone_app_reply", sync.echoes.length);
  recordWebhookEvent("history_message", sync.history.length);
  recordWebhookEvent("contact_sync", sync.contacts.length);
  logger.info(
    { fields: [...fields], messages: messages.length, statuses: statuses.length, echoes: sync.echoes.length, history: sync.history.length },
    "WhatsApp webhook received",
  );

  for (const m of sync.echoes) {
    try { await importSyncedMessage(m, "echo", io); }
    catch (err) { logger.error({ err, externalId: m.externalId }, "WhatsApp echo import failed"); }
  }
  let imported = 0;
  for (const m of sync.history) {
    try { if (await importSyncedMessage(m, "history")) imported++; }
    catch (err) { logger.error({ err, externalId: m.externalId }, "WhatsApp history import failed"); }
  }
  if (sync.history.length) {
    logger.info({ received: sync.history.length, imported }, "WhatsApp history chunk imported");
    io?.emit("conversation_updated", { conversationId: 0 });
  }
  for (const c of sync.contacts) {
    try { await applyContactSync(c); }
    catch (err) { logger.error({ err }, "WhatsApp contact sync failed"); }
  }

  for (const m of messages) {
    try {
      const result = await ingestInbound(
        "whatsapp",
        { from: m.from, name: m.name, body: m.body, externalId: m.externalId },
        io,
      );
      if (m.media && !result.duplicate && result.messageId) {
        const media = m.media;
        // After the 200 below: a slow download must never make Meta retry.
        setImmediate(() => void attachMedia(result.messageId, () => downloadWhatsAppMedia(media.id), {
          filename: media.filename, source: "whatsapp", io, conversationId: result.conversationId,
        }));
      }
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

/* ------------------- Facebook Messenger & Instagram (Meta) ---------------- */

/** Find a Messenger/Instagram customer by their page-scoped id, or create one. */
async function findOrCreateSocialCustomer(channel: SocialChannel, userId: string) {
  const col = channel === "messenger" ? customersTable.messengerPsid : customersTable.instagramId;
  const [existing] = await db.select().from(customersTable).where(eq(col, userId)).limit(1);
  if (existing) return existing;
  const name = (await fetchSocialProfileName(channel, userId)) ?? `${channel === "messenger" ? "Messenger" : "Instagram"} user ${userId.slice(-4)}`;
  const [created] = await db
    .insert(customersTable)
    .values({
      name,
      phone: "",
      tags: ["New"],
      ...(channel === "messenger" ? { messengerPsid: userId } : { instagramId: userId }),
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  // Lost a race with a parallel delivery for the same person.
  const [again] = await db.select().from(customersTable).where(eq(col, userId)).limit(1);
  return again!;
}

/** A message the business sent from Meta's own inbox (Business Suite / the app). */
async function importSocialEcho(m: SocialInbound, io?: IOServer): Promise<void> {
  const customer = await findOrCreateSocialCustomer(m.channel, m.customerId);
  let [conv] = await db
    .select()
    .from(conversationsTable)
    .where(and(eq(conversationsTable.customerId, customer.id), eq(conversationsTable.channel, m.channel)))
    .orderBy(desc(conversationsTable.createdAt))
    .limit(1);
  if (!conv) {
    [conv] = await db
      .insert(conversationsTable)
      .values({ customerId: customer.id, channel: m.channel, status: "pending", lastMessage: m.body, lastMessageAt: m.timestamp, lastSenderType: "agent" })
      .returning();
  }
  // Messages we sent through the API already carry this id — skipped here.
  const inserted = await db
    .insert(messagesTable)
    .values({ conversationId: conv.id, senderType: "agent", body: m.body, attachments: m.attachments, status: "sent", externalId: m.externalId, createdAt: m.timestamp })
    .onConflictDoNothing({ target: messagesTable.externalId })
    .returning();
  if (!inserted.length) return;
  await db
    .update(conversationsTable)
    .set({ lastMessage: m.body, lastMessageAt: m.timestamp, lastSenderType: "agent", unreadCount: 0, ...(conv.status === "open" ? { status: "pending" as const } : {}) })
    .where(eq(conversationsTable.id, conv.id));
  io?.to(`conv:${conv.id}`).emit("new_message", inserted[0]);
  io?.emit("conversation_updated", { conversationId: conv.id });
}

/** Delivery/read receipts: everything we sent up to the watermark. */
async function applySocialReceipt(r: SocialReceipt, io?: IOServer): Promise<void> {
  const col = r.channel === "messenger" ? customersTable.messengerPsid : customersTable.instagramId;
  const [cust] = await db.select({ id: customersTable.id }).from(customersTable).where(eq(col, r.customerId)).limit(1);
  if (!cust) return;
  const next = r.kind === "read" ? "read" : "delivered";
  const allowed = r.kind === "read" ? sql`m.status IN ('sent','delivered')` : sql`m.status = 'sent'`;
  const updated = await db.execute(sql`
    UPDATE messages m SET status = ${next}
    FROM conversations c
    WHERE m.conversation_id = c.id AND c.customer_id = ${cust.id} AND c.channel = ${r.channel}
      AND m.sender_type = 'agent' AND m.is_note = false AND m.external_id IS NOT NULL
      AND m.created_at <= ${r.watermark} AND ${allowed}
    RETURNING m.id
  `);
  for (const row of (updated.rows ?? []) as { id: number }[]) io?.emit("message_status", { messageId: row.id, status: next });
}

function verifySocialHandshake(req: Request, res: import("express").Response, label: string): void {
  const { verifyToken } = socialConfig();
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (verifyToken && mode === "subscribe" && typeof token === "string" && typeof challenge === "string" && safeEqual(token, verifyToken)) {
    res.status(200).type("text/plain").send(challenge);
    return;
  }
  logger.warn(`${label} webhook verification rejected`);
  res.sendStatus(403);
}

router.get("/webhooks/messenger", (req, res) => verifySocialHandshake(req, res, "Messenger"));
router.get("/webhooks/instagram", (req, res) => verifySocialHandshake(req, res, "Instagram"));

/** Meta-signed Messenger / Instagram delivery. Returns true when handled. */
async function handleSignedSocial(req: Request, res: import("express").Response): Promise<void> {
  const { appSecret } = socialConfig();
  if (!appSecret) {
    logger.error("META_APP_SECRET / WHATSAPP_APP_SECRET is not set — rejecting Messenger/Instagram webhook");
    res.sendStatus(503);
    return;
  }
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!verifyMetaSignature(rawBody, req.header("x-hub-signature-256"), appSecret)) {
    logger.warn("Messenger/Instagram webhook signature mismatch");
    res.sendStatus(401);
    return;
  }
  const io = getIo(req);
  const { channel, messages, receipts } = parseSocialWebhook(req.body);
  if (!channel) { res.sendStatus(200); return; }
  recordWebhookEvent(`${channel}:webhook`);
  recordWebhookEvent(`${channel}:customer_message`, messages.filter((m) => m.direction === "in").length);
  recordWebhookEvent(`${channel}:echo`, messages.filter((m) => m.direction === "out").length);
  recordWebhookEvent(`${channel}:receipt`, receipts.length);
  logger.info({ channel, messages: messages.length, receipts: receipts.length }, "Meta social webhook received");

  for (const m of messages) {
    try {
      if (m.direction === "out") { await importSocialEcho(m, io); continue; }
      const customer = await findOrCreateSocialCustomer(m.channel, m.customerId);
      const result = await ingestInbound(m.channel, { body: m.body, externalId: m.externalId, attachments: m.attachments }, io, customer);
      // Meta CDN links expire: keep our own copy.
      if (!result.duplicate && result.messageId) {
        for (const url of m.attachments) {
          setImmediate(() => void attachMedia(result.messageId, () => downloadUrl(url), {
            source: m.channel, replaceUrl: url, io, conversationId: result.conversationId,
          }));
        }
      }
    } catch (err) {
      logger.error({ err, externalId: m.externalId, channel }, "Messenger/Instagram inbound failed");
    }
  }
  for (const r of receipts) {
    try { await applySocialReceipt(r, io); }
    catch (err) { logger.error({ err, channel }, "Messenger/Instagram receipt failed"); }
  }
  res.sendStatus(200);
}

/* ---------------------- Generic JSON hook (Messenger etc.) ---------------- */

router.post("/webhooks/:provider", async (req, res) => {
  // Meta's own signed deliveries for Messenger / Instagram.
  if ((req.params.provider === "messenger" || req.params.provider === "instagram") && req.header("x-hub-signature-256")) {
    await handleSignedSocial(req, res);
    return;
  }

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
