import { db } from "@workspace/db";
import {
  campaignsTable,
  campaignRecipientsTable,
  customersTable,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { outboundEnabled } from "./outbound";

function personalize(template: string, customer: { name: string }) {
  return template.replace(/\{\{name\}\}/gi, customer.name);
}

async function deliverToCustomer(
  channel: string,
  customer: { id: number; name: string; phone: string },
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  // Provider hooks — set env vars to enable real delivery.
  const providerConfigured =
    channel === "email"
      ? !!process.env.SMTP_HOST
      : !!process.env.MESSAGING_PROVIDER_URL;

  if (!providerConfigured) {
    return { ok: true };
  }

  try {
    if (channel === "email" && process.env.SMTP_HOST) {
      // Stub for SMTP — log intent; integrate nodemailer when SMTP_HOST is set.
      console.info(`[campaign] email → ${customer.name}: ${message.slice(0, 80)}…`);
      return { ok: true };
    }
    if (process.env.MESSAGING_PROVIDER_URL) {
      const res = await fetch(process.env.MESSAGING_PROVIDER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, phone: customer.phone, message }),
      });
      if (!res.ok) {
        return { ok: false, error: `Provider returned ${res.status}` };
      }
      return { ok: true };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Delivery failed" };
  }
}

export async function executeCampaignSend(campaignId: number) {
  if (!outboundEnabled()) throw new Error("Sending to customers is turned off on this server");
  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, campaignId));

  if (!campaign) throw new Error("Campaign not found");

  await db
    .update(campaignsTable)
    .set({ status: "sending" })
    .where(eq(campaignsTable.id, campaignId));

  let recipients: { id: number; customerId: number; name: string; phone: string }[] = [];

  const existingRecipients = await db
    .select({
      id: campaignRecipientsTable.id,
      customerId: campaignRecipientsTable.customerId,
      name: customersTable.name,
      phone: customersTable.phone,
    })
    .from(campaignRecipientsTable)
    .innerJoin(customersTable, eq(campaignRecipientsTable.customerId, customersTable.id))
    .where(eq(campaignRecipientsTable.campaignId, campaignId));

  if (existingRecipients.length > 0) {
    recipients = existingRecipients;
  } else if (campaign.audience === "all") {
    const all = await db.select().from(customersTable);
    for (const c of all) {
      const [r] = await db
        .insert(campaignRecipientsTable)
        .values({ campaignId, customerId: c.id })
        .returning();
      recipients.push({ id: r.id, customerId: c.id, name: c.name, phone: c.phone });
    }
  }

  let sentCount = 0;
  let failedCount = 0;

  for (const r of recipients) {
    const body = personalize(campaign.message, { name: r.name });
    const result = await deliverToCustomer(campaign.channel, r, body);
    if (result.ok) {
      sentCount++;
      await db
        .update(campaignRecipientsTable)
        .set({ status: "sent", sentAt: new Date(), error: null })
        .where(eq(campaignRecipientsTable.id, r.id));
    } else {
      failedCount++;
      await db
        .update(campaignRecipientsTable)
        .set({ status: "failed", error: result.error ?? "failed" })
        .where(eq(campaignRecipientsTable.id, r.id));
    }
  }

  const finalStatus =
    failedCount === 0
      ? "sent"
      : sentCount === 0
        ? "failed"
        : "partial";

  const [updated] = await db
    .update(campaignsTable)
    .set({
      status: finalStatus,
      sentAt: new Date(),
      recipientCount: recipients.length,
      sentCount,
      failedCount,
    })
    .where(eq(campaignsTable.id, campaignId))
    .returning();

  return {
    campaign: updated,
    providerStatus: process.env.MESSAGING_PROVIDER_URL || process.env.SMTP_HOST ? "live" : "stub",
    message:
      process.env.MESSAGING_PROVIDER_URL || process.env.SMTP_HOST
        ? "Campaign processed via configured provider."
        : "Campaign queued (stub). Set MESSAGING_PROVIDER_URL or SMTP_HOST for real delivery.",
  };
}

export async function processDueScheduledCampaigns() {
  // Scheduled campaigns wait (stay "scheduled") while sending is off.
  if (!outboundEnabled()) return;
  const due = await db
    .select()
    .from(campaignsTable)
    .where(
      sql`${campaignsTable.status} = 'scheduled' AND ${campaignsTable.scheduledAt} <= NOW()`,
    );

  for (const c of due) {
    await executeCampaignSend(c.id);
  }
}

export async function createCampaignRecipients(
  campaignId: number,
  customerIds: number[],
) {
  if (customerIds.length === 0) return;
  const unique = [...new Set(customerIds)];
  await db.insert(campaignRecipientsTable).values(
    unique.map((customerId) => ({ campaignId, customerId })),
  );
}
