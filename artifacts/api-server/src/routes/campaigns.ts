import { Router } from "express";
import { db } from "@workspace/db";
import { campaignsTable, campaignRecipientsTable, customersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import {
  executeCampaignSend,
  createCampaignRecipients,
} from "../lib/campaign-sender";
import { outboundEnabled, OUTBOUND_DISABLED_ERROR } from "../lib/outbound";

const router = Router();

router.get("/campaigns", requireAuth, requireAdmin, async (_req, res) => {
  const rows = await db
    .select()
    .from(campaignsTable)
    .orderBy(desc(campaignsTable.createdAt));
  res.json(rows);
});

router.get("/campaigns/:id/recipients", requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db
    .select({
      id: campaignRecipientsTable.id,
      customerId: campaignRecipientsTable.customerId,
      customerName: customersTable.name,
      phone: customersTable.phone,
      status: campaignRecipientsTable.status,
      error: campaignRecipientsTable.error,
      sentAt: campaignRecipientsTable.sentAt,
    })
    .from(campaignRecipientsTable)
    .innerJoin(customersTable, eq(campaignRecipientsTable.customerId, customersTable.id))
    .where(eq(campaignRecipientsTable.campaignId, id));
  res.json(rows);
});

router.post("/campaigns", requireAuth, requireAdmin, async (req, res) => {
  const { name, channel, message, audience, customerIds, scheduledAt } = req.body ?? {};
  if (!name || typeof name !== "string" || name.trim().length < 2) {
    res.status(400).json({ error: "name (min 2 chars) is required" });
    return;
  }
  if (!message || typeof message !== "string" || message.trim().length < 1) {
    res.status(400).json({ error: "message is required" });
    return;
  }
  const allowedChannels = ["whatsapp", "messenger", "instagram", "sms", "email"];
  const ch = allowedChannels.includes(channel) ? channel : "whatsapp";
  const aud =
    audience === "selected" && Array.isArray(customerIds) && customerIds.length > 0
      ? "selected"
      : "all";

  const scheduleDate =
    scheduledAt && !Number.isNaN(new Date(scheduledAt).getTime())
      ? new Date(scheduledAt)
      : null;
  const status = scheduleDate && scheduleDate > new Date() ? "scheduled" : "draft";

  const [row] = await db
    .insert(campaignsTable)
    .values({
      name: name.trim(),
      channel: ch,
      message: message.trim(),
      audience: aud,
      status,
      scheduledAt: scheduleDate,
      recipientCount: aud === "selected" ? customerIds.length : 0,
    })
    .returning();

  if (aud === "selected" && Array.isArray(customerIds)) {
    const ids = customerIds.map(Number).filter((n) => Number.isFinite(n));
    await createCampaignRecipients(row.id, ids);
  }

  res.status(201).json(row);
});

router.delete("/campaigns/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  await db.delete(campaignsTable).where(eq(campaignsTable.id, id));
  res.status(204).end();
});

router.post("/campaigns/:id/send", requireAuth, requireAdmin, async (req, res) => {
  if (!outboundEnabled()) {
    res.status(403).json(OUTBOUND_DISABLED_ERROR);
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  try {
    const result = await executeCampaignSend(id);
    res.json(result);
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : "Send failed" });
  }
});

export default router;
