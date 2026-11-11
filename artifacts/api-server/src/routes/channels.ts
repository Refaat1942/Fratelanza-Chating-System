/**
 * Settings → Channels: one status card per channel. Read-only — this never
 * changes a Meta subscription, token or webhook.
 */
import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { whatsappConfig } from "../lib/whatsapp";
import { socialConfig, checkSocialConnection, type SocialChannel } from "../lib/meta-social";
import { webhookStats } from "../lib/webhook-stats";
import { outboundEnabled } from "../lib/outbound";

const router = Router();

async function checkWhatsApp(): Promise<{ ok: boolean; account?: string; id?: string; error?: string }> {
  const c = whatsappConfig();
  if (!c.accessToken || !c.phoneNumberId) return { ok: false, error: "WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set" };
  try {
    const res = await fetch(
      `https://graph.facebook.com/${c.apiVersion}/${c.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
      { headers: { Authorization: `Bearer ${c.accessToken}` }, signal: AbortSignal.timeout(8_000) },
    );
    const d = (await res.json().catch(() => ({}))) as { display_phone_number?: string; verified_name?: string; error?: { message?: string; code?: number } };
    if (!res.ok || d.error) return { ok: false, error: d.error ? `${d.error.code ?? res.status}: ${d.error.message}` : `HTTP ${res.status}` };
    return { ok: true, id: c.phoneNumberId, account: [d.verified_name, d.display_phone_number].filter(Boolean).join(" · ") };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Request failed" };
  }
}

router.get("/channels/status", requireAuth, requireAdmin, async (req, res) => {
  const wa = whatsappConfig();
  const so = socialConfig();
  const ev = webhookStats().events;
  const check = req.query["check"] === "1";

  const counts = await db.execute(sql`
    SELECT channel, COUNT(*)::int AS conversations,
           COUNT(*) FILTER (WHERE status <> 'completed')::int AS active,
           MAX(last_message_at) AS last_activity
    FROM conversations GROUP BY channel
  `);
  const byChannel = Object.fromEntries(((counts.rows ?? []) as { channel: string }[]).map((r) => [r.channel, r]));

  const lastOf = (keys: string[]) =>
    keys.map((k) => ev[k]?.lastAt).filter(Boolean).sort().pop() ?? null;

  const social = async (ch: SocialChannel) => {
    const token = ch === "messenger" ? so.messengerToken : so.instagramToken;
    return {
      key: ch,
      name: ch === "messenger" ? "Facebook Messenger" : "Instagram Direct",
      webhookPath: `/api/webhooks/${ch}`,
      config: {
        accessToken: !!token,
        appSecret: !!so.appSecret,
        verifyToken: !!so.verifyToken,
        ...(ch === "instagram" ? { graphHost: so.instagramHost } : {}),
      },
      ready: !!(token && so.appSecret && so.verifyToken),
      lastWebhookAt: lastOf([`${ch}:webhook`]),
      events: {
        customerMessages: ev[`${ch}:customer_message`]?.count ?? 0,
        echoes: ev[`${ch}:echo`]?.count ?? 0,
        receipts: ev[`${ch}:receipt`]?.count ?? 0,
      },
      stats: byChannel[ch] ?? null,
      connection: check && token ? await checkSocialConnection(ch) : null,
    };
  };

  res.set("Cache-Control", "no-store");
  res.json({
    outboundEnabled: outboundEnabled(),
    channels: [
      {
        key: "whatsapp",
        name: "WhatsApp Business",
        webhookPath: "/api/webhooks/whatsapp",
        config: {
          accessToken: !!wa.accessToken,
          phoneNumberId: !!wa.phoneNumberId,
          appSecret: !!wa.appSecret,
          verifyToken: !!wa.verifyToken,
          businessAccountId: !!process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
        },
        ready: !!(wa.accessToken && wa.phoneNumberId && wa.appSecret && wa.verifyToken),
        lastWebhookAt: lastOf(Object.keys(ev).filter((k) => k.startsWith("field:"))),
        events: {
          customerMessages: ev["customer_message"]?.count ?? 0,
          echoes: ev["phone_app_reply"]?.count ?? 0,
          receipts: ev["status_update"]?.count ?? 0,
        },
        stats: byChannel["whatsapp"] ?? null,
        connection: check ? await checkWhatsApp() : null,
      },
      await social("messenger"),
      await social("instagram"),
    ],
  });
});

export default router;
