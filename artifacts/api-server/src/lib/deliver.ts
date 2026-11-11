/**
 * Send a stored message to the customer over its conversation's channel
 * (WhatsApp Cloud API, Messenger / Instagram Send API). Shared by agent
 * replies and bot replies. On failure the message is marked "failed".
 * Callers check the kill switch (outboundEnabled) first.
 */
import { eq } from "drizzle-orm";
import { db, conversationsTable, customersTable, messagesTable, type Message } from "@workspace/db";
import { sendWhatsAppText, whatsappSendingConfigured } from "./whatsapp";
import { sendSocialText, socialSendingConfigured } from "./meta-social";
import { logger } from "./logger";

export async function deliverToCustomer(conversationId: number, message: Message): Promise<{ delivered: Message; deliveryError?: string }> {
  const [target] = await db
    .select({
      channel: conversationsTable.channel,
      phone: customersTable.phone,
      messengerPsid: customersTable.messengerPsid,
      instagramId: customersTable.instagramId,
    })
    .from(conversationsTable)
    .leftJoin(customersTable, eq(conversationsTable.customerId, customersTable.id))
    .where(eq(conversationsTable.id, conversationId))
    .limit(1);

  let send: (() => Promise<{ externalId: string }>) | null = null;
  if (target?.channel === "whatsapp" && target.phone && whatsappSendingConfigured()) {
    send = () => sendWhatsAppText(target.phone!, message.body);
  } else if (target?.channel === "messenger" && target.messengerPsid && socialSendingConfigured("messenger")) {
    send = () => sendSocialText("messenger", target.messengerPsid!, message.body);
  } else if (target?.channel === "instagram" && target.instagramId && socialSendingConfigured("instagram")) {
    send = () => sendSocialText("instagram", target.instagramId!, message.body);
  }
  if (!send) return { delivered: message };

  try {
    const { externalId } = await send();
    const [delivered] = await db.update(messagesTable).set({ externalId }).where(eq(messagesTable.id, message.id)).returning();
    return { delivered: delivered ?? message };
  } catch (err) {
    const deliveryError = err instanceof Error ? err.message : "Send failed";
    logger.error({ err, messageId: message.id, channel: target?.channel }, "Outbound send failed");
    const [delivered] = await db.update(messagesTable).set({ status: "failed" }).where(eq(messagesTable.id, message.id)).returning();
    return { delivered: delivered ?? message, deliveryError };
  }
}
